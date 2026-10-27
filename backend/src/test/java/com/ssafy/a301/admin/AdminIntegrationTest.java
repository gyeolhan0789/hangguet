package com.ssafy.a301.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.admin.config.AdminPasswordEncoder;
import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.jwt.AdminTokens;
import com.ssafy.a301.admin.repository.AdminRepository;
import com.ssafy.a301.admin.service.StreakFreezeGrantService;
import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL · Redis로 8. 관리자 API를 확인한다. 관리자 토큰과 회원 토큰이 서로의 API에 쓰이지 않는지, 배포 → 지급 → 자동 공지 → 유지권
 * 사용 → 연습 기록 흐름, 공지 확인, 오류 코드를 본다. 토큰은 실제로 발급해 디코더 검증을 거친다. 만든 데이터만 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class AdminIntegrationTest {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final String PASSWORD = "admin-it-pass";

    @Autowired private MockMvc mvc;
    @Autowired private AdminRepository admins;
    @Autowired private UserRepository users;
    @Autowired private AdminPasswordEncoder passwords;
    @Autowired private AccessTokens accessTokens;
    @Autowired private JwtEncoder jwtEncoder;
    @Autowired private StreakFreezeGrantService grantService;
    @Autowired private JdbcTemplate jdbc;
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<Long> userIds = new ArrayList<>();
    private Admin admin;

    @BeforeEach
    void createAdmin() {
        admin =
                admins.saveAndFlush(
                        new Admin(
                                "admin-it-" + UUID.randomUUID(),
                                passwords.encode(PASSWORD),
                                "검증 운영자"));
    }

    @AfterEach
    void cleanup() {
        long adminId = admin.getId();
        String grants = "SELECT id FROM streak_freeze_grants WHERE admin_id = ?";
        jdbc.update("DELETE FROM streak_freezes WHERE grant_id IN (" + grants + ")", adminId);
        jdbc.update(
                "DELETE FROM streak_freeze_grant_targets WHERE grant_id IN (" + grants + ")",
                adminId);
        jdbc.update("DELETE FROM streak_freeze_grants WHERE admin_id = ?", adminId);
        jdbc.update(
                "DELETE FROM notice_reads WHERE notice_id IN (SELECT id FROM notices WHERE admin_id"
                        + " = ?)",
                adminId);
        jdbc.update("DELETE FROM notices WHERE admin_id = ?", adminId);
        jdbc.update("DELETE FROM admins WHERE id = ?", adminId);
        for (long id : userIds) {
            jdbc.update("DELETE FROM practice_logs WHERE user_id = ?", id);
            jdbc.update("DELETE FROM users WHERE id = ?", id);
        }
    }

    @Test
    void adminTokenAndUserTokenOnlyWorkOnTheirOwnApis() throws Exception {
        long user = newUser();
        String adminToken = login();
        String userToken = accessTokens.issue(user, "회원");

        mvc.perform(
                        get("/api/v1/admin/metrics")
                                .header(HttpHeaders.AUTHORIZATION, bearer(adminToken)))
                .andExpect(status().isOk());
        mvc.perform(
                        get("/api/v1/admin/metrics")
                                .header(HttpHeaders.AUTHORIZATION, bearer(userToken)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mvc.perform(get("/api/v1/users/me").header(HttpHeaders.AUTHORIZATION, bearer(adminToken)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void expiredAdminTokenIsTokenExpiredInCommonProblemFormat() throws Exception {
        Instant past = Instant.now().minusSeconds(3600);
        String expired =
                jwtEncoder
                        .encode(
                                JwtEncoderParameters.from(
                                        JwsHeader.with(MacAlgorithm.HS256).build(),
                                        JwtClaimsSet.builder()
                                                .issuer(AdminTokens.ISSUER)
                                                .subject(Long.toString(admin.getId()))
                                                .issuedAt(past.minusSeconds(60))
                                                .expiresAt(past)
                                                .build()))
                        .getTokenValue();

        // 회원 API와 같은 ProblemDetail + code 형식
        mvc.perform(get("/api/v1/admin/metrics").header(HttpHeaders.AUTHORIZATION, bearer(expired)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("TOKEN_EXPIRED"))
                .andExpect(jsonPath("$.title").value("Unauthorized"))
                .andExpect(jsonPath("$.instance").value("/api/v1/admin/metrics"));
    }

    @Test
    void wrongPasswordIsAdminLoginFailed() throws Exception {
        mvc.perform(
                        post("/api/v1/admin/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"loginId\":\"%s\",\"password\":\"틀림\"}"
                                                .formatted(admin.getLoginId())))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("ADMIN_LOGIN_FAILED"));
    }

    @Test
    void logoutRevokesThatTokenBeforeItExpires() throws Exception {
        String token = login();

        mvc.perform(
                        post("/api/v1/admin/auth/logout")
                                .header(HttpHeaders.AUTHORIZATION, bearer(token)))
                .andExpect(status().isNoContent());
        mvc.perform(get("/api/v1/admin/metrics").header(HttpHeaders.AUTHORIZATION, bearer(token)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void grantForAllTodayIsGrantedAtOnceWithNotice() throws Exception {
        long user = newUser();
        LocalDate today = LocalDate.now(KST);
        String token = login();

        JsonNode grant =
                grant(token, "ALL", null, today, today.minusDays(1))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.status").value("GRANTED"))
                        .andExpect(jsonPath("$.grantedAt").isNotEmpty())
                        .andExpect(jsonPath("$.adminName").value("검증 운영자"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8)
                        .transform(json::readTree);

        JsonNode mine = body(asUser(user, get("/api/v1/users/me/streak-freezes")));
        assertThat(mine.get("availableCount").asInt()).isEqualTo(1);
        assertThat(mine.get("freezes").size()).isEqualTo(1);
        assertThat(mine.get("freezes").get(0).get("fillableDate").asString())
                .isEqualTo(today.minusDays(1).toString());
        assertThat(mine.get("freezes").get(0).get("expiresAt").asString())
                .startsWith(today.plusDays(14).toString());
        // 이번 배포로 만든 공지(이 관리자가 쓴 것)가 회원 목록에 보인다
        long noticeId =
                jdbc.queryForObject(
                        "SELECT id FROM notices WHERE admin_id = ?", Long.class, admin.getId());
        JsonNode notice =
                body(asUser(user, get("/api/v1/notices")))
                        .get("content")
                        .valueStream()
                        .filter(n -> n.get("id").asLong() == noticeId)
                        .findFirst()
                        .orElseThrow();
        LocalDate fillable = today.minusDays(1);
        LocalDate until = today.plusDays(14);
        assertThat(notice.get("title").asString()).isEqualTo("스트릭 유지권을 드렸어요");
        assertThat(notice.get("content").asString())
                .isEqualTo(
                        "%d월 %d일을 메울 수 있는 유지권 1개를 드렸어요. 마이페이지에서 %d월 %d일까지 쓸 수 있어요."
                                .formatted(
                                        fillable.getMonthValue(),
                                        fillable.getDayOfMonth(),
                                        until.getMonthValue(),
                                        until.getDayOfMonth()));
        assertThat(notice.get("read").asBoolean()).isFalse();
        assertThat(grant.get("targetCount").asInt()).isGreaterThanOrEqualTo(1);
    }

    @Test
    void scheduledUsersGrantIsGrantedOnGrantDateWithoutNotice() throws Exception {
        long user = newUser();
        LocalDate today = LocalDate.now(KST);
        String token = login();

        JsonNode grant =
                grant(token, "USERS", List.of(user), today.plusDays(3), today.plusDays(2))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.status").value("SCHEDULED"))
                        .andExpect(jsonPath("$.targetCount").value(1))
                        .andExpect(jsonPath("$.grantedAt").isEmpty())
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8)
                        .transform(json::readTree);
        assertThat(
                        body(asUser(user, get("/api/v1/users/me/streak-freezes")))
                                .get("availableCount")
                                .asInt())
                .isZero();

        // 지급 날짜 전에는 지급 작업이 돌아도 그대로다. grantDue는 공유 DB에서 날짜가 된 모든 배포를 지급한다
        grantService.grantDue();
        assertThat(
                        body(asUser(user, get("/api/v1/users/me/streak-freezes")))
                                .get("availableCount")
                                .asInt())
                .isZero();

        // 지급 날짜가 됐다고 보고 지급 작업을 돌린다
        jdbc.update(
                "UPDATE streak_freeze_grants SET grant_date = ? WHERE id = ?",
                today,
                grant.get("id").asLong());
        grantService.grantDue();

        assertThat(
                        body(asUser(user, get("/api/v1/users/me/streak-freezes")))
                                .get("availableCount")
                                .asInt())
                .isEqualTo(1);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status FROM streak_freeze_grants WHERE id = ?",
                                String.class,
                                grant.get("id").asLong()))
                .isEqualTo("GRANTED");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notices WHERE admin_id = ?",
                                Long.class,
                                admin.getId()))
                .isZero();
    }

    @Test
    void usingFreezeRecordsPracticeDayOnce() throws Exception {
        long user = newUser();
        long other = newUser();
        LocalDate yesterday = LocalDate.now(KST).minusDays(1);
        String token = login();
        grant(token, "USERS", List.of(user), LocalDate.now(KST), yesterday, 2)
                .andExpect(status().isCreated());
        JsonNode freezes =
                body(asUser(user, get("/api/v1/users/me/streak-freezes"))).get("freezes");
        long first = freezes.get(0).get("id").asLong();
        long second = freezes.get(1).get("id").asLong();

        use(user, first)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.practiceDate").value(yesterday.toString()))
                .andExpect(jsonPath("$.freezeId").value(first))
                .andExpect(jsonPath("$.availableCount").value(1))
                .andExpect(jsonPath("$.currentStreak").value(1));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM practice_logs WHERE user_id = ? AND"
                                        + " practice_date = ?",
                                Long.class,
                                user,
                                yesterday))
                .isEqualTo(1);

        use(user, first)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STREAK_FREEZE_NOT_AVAILABLE"));
        use(user, second)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STREAK_FREEZE_DATE_NOT_ALLOWED"));
        // 실패한 사용은 유지권을 남긴다
        assertThat(
                        body(asUser(user, get("/api/v1/users/me/streak-freezes")))
                                .get("availableCount")
                                .asInt())
                .isEqualTo(1);
        use(other, second)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("STREAK_FREEZE_NOT_FOUND"));
    }

    @Test
    void readingNoticeIsRecordedOnce() throws Exception {
        long user = newUser();
        String token = login();
        grant(token, "ALL", null, LocalDate.now(KST), LocalDate.now(KST))
                .andExpect(status().isCreated());
        long noticeId =
                jdbc.queryForObject(
                        "SELECT id FROM notices WHERE admin_id = ?", Long.class, admin.getId());

        mvc.perform(asUser(user, post("/api/v1/notices/" + noticeId + "/read")))
                .andExpect(status().isNoContent());
        mvc.perform(asUser(user, post("/api/v1/notices/" + noticeId + "/read")))
                .andExpect(status().isNoContent());
        mvc.perform(asUser(user, post("/api/v1/notices/0/read")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOTICE_NOT_FOUND"));

        JsonNode content = body(asUser(user, get("/api/v1/notices"))).get("content");
        JsonNode mine =
                content.valueStream()
                        .filter(n -> n.get("id").asLong() == noticeId)
                        .findFirst()
                        .orElseThrow();
        assertThat(mine.get("read").asBoolean()).isTrue();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notice_reads WHERE notice_id = ? AND user_id"
                                        + " = ?",
                                Long.class,
                                noticeId,
                                user))
                .isEqualTo(1);
    }

    @Test
    void grantRejectsMissingTargets() throws Exception {
        String token = login();
        LocalDate today = LocalDate.now(KST);

        grant(token, "USERS", List.of(), today, today)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("userIds"));
        grant(token, "ALL", null, today, today, 0)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("quantity"));
        grant(token, "USERS", List.of(0L), today, today)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        grant(token, "ALL", List.of(newUser()), today, today)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("userIds"));
    }

    @Test
    void metricsCountsSevenDaysAndFourCriteria() throws Exception {
        String token = login();

        mvc.perform(get("/api/v1/admin/metrics").header(HttpHeaders.AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.date").value(LocalDate.now(KST).toString()))
                .andExpect(jsonPath("$.practice.daily.length()").value(7))
                .andExpect(
                        jsonPath("$.practice.daily[6].date").value(LocalDate.now(KST).toString()))
                .andExpect(jsonPath("$.averageScores.length()").value(4))
                .andExpect(jsonPath("$.averageScores[0].criterion").value("JOB_FIT"))
                .andExpect(jsonPath("$.practice.retention[*].days").value(contains(1, 3, 7)))
                .andExpect(
                        jsonPath("$.interviews.personas[*].persona")
                                .value(contains("DEVIL", "COFFEE_CHAT")))
                .andExpect(jsonPath("$.speech.sessions").isNumber())
                .andExpect(jsonPath("$.inquiries.waiting").isNumber())
                .andExpect(jsonPath("$.applications").isNumber());
    }

    @Test
    void metricsCountsReturnOnExactlyTheNthDayAfterJoining() throws Exception {
        String token = login();
        LocalDate today = LocalDate.now(KST);
        JsonNode before = metrics(token).get("practice");

        // 어제(한국 시간) 가입해 오늘 연습한 회원: D1 대상이고 돌아왔다
        long returned = joinedOn(today.minusDays(1));
        practiced(returned, today);
        // 어제 가입해 오늘 연습하지 않은 회원: D1 대상이지만 돌아오지 않았다
        joinedOn(today.minusDays(1));
        // 그제 가입해 오늘(2일째) 연습한 회원: D1 대상이지만 1일째가 아니라 돌아오지 않았다
        practiced(joinedOn(today.minusDays(2)), today);
        // 오늘 가입한 회원: 아직 D1 대상이 아니다
        practiced(newUser(), today);

        JsonNode after = metrics(token).get("practice");
        JsonNode d1Before = before.get("retention").get(0);
        JsonNode d1After = after.get("retention").get(0);
        assertThat(d1After.get("eligible").asInt() - d1Before.get("eligible").asInt()).isEqualTo(3);
        assertThat(d1After.get("returned").asInt() - d1Before.get("returned").asInt()).isEqualTo(1);
        assertThat(after.get("practicedWeek").asInt() - before.get("practicedWeek").asInt())
                .isEqualTo(3);
    }

    private JsonNode metrics(String token) throws Exception {
        return json.readTree(
                mvc.perform(
                                get("/api/v1/admin/metrics")
                                        .header(HttpHeaders.AUTHORIZATION, bearer(token)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8));
    }

    // 그날 한국 시간 정오에 가입한 회원
    private long joinedOn(LocalDate date) {
        long id = newUser();
        jdbc.update(
                "UPDATE users SET created_at = ? WHERE id = ?",
                date.atTime(12, 0).atZone(KST).toOffsetDateTime(),
                id);
        return id;
    }

    private void practiced(long userId, LocalDate date) {
        jdbc.update(
                "INSERT INTO practice_logs (user_id, practice_date, created_at) VALUES (?, ?,"
                        + " now())",
                userId,
                date);
    }

    @Test
    void scheduledAllGrantMakesNoticeWhenGranted() throws Exception {
        newUser();
        LocalDate today = LocalDate.now(KST);
        String token = login();
        long id =
                grant(token, "ALL", null, today.plusDays(3), today)
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8)
                        .transform(json::readTree)
                        .get("id")
                        .asLong();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notices WHERE admin_id = ?",
                                Long.class,
                                admin.getId()))
                .isZero();

        jdbc.update("UPDATE streak_freeze_grants SET grant_date = ? WHERE id = ?", today, id);
        grantService.grantDue();

        // 공지는 지급 날짜 0시부터 유효기간(2주) 동안 게시한다
        assertThat(
                        jdbc.queryForObject(
                                "SELECT starts_at = ?::date::timestamp AT TIME ZONE 'Asia/Seoul'"
                                        + " AND ends_at = (?::date + 14)::timestamp AT TIME ZONE"
                                        + " 'Asia/Seoul' FROM notices WHERE admin_id = ?",
                                Boolean.class,
                                today,
                                today,
                                admin.getId()))
                .isTrue();
    }

    @Test
    void noticesShowOnlyPostedOnesNewestFirst() throws Exception {
        long user = newUser();
        long adminId = admin.getId();
        String insert =
                "INSERT INTO notices (admin_id, title, content, starts_at, ends_at, created_at,"
                        + " updated_at) VALUES (?, ?, '본문', now() + ?::interval, %s, now(), now())";
        jdbc.update(insert.formatted("NULL"), adminId, "어제 공지", "-1 day");
        jdbc.update(insert.formatted("NULL"), adminId, "한 시간 전 공지", "-1 hour");
        jdbc.update(insert.formatted("now() - interval '1 minute'"), adminId, "끝난 공지", "-2 day");
        jdbc.update(insert.formatted("NULL"), adminId, "내일 공지", "1 day");

        List<String> titles =
                body(asUser(user, get("/api/v1/notices")))
                        .get("content")
                        .valueStream()
                        .map(n -> n.get("title").asString())
                        .filter(t -> t.endsWith(" 공지"))
                        .toList();

        assertThat(titles).containsExactly("한 시간 전 공지", "어제 공지");
    }

    @Test
    void noticeCrudKeepsUnsentFieldsAndClearsEndsAtWithNull() throws Exception {
        String token = login();
        long id =
                json.readTree(
                                mvc.perform(
                                                post("/api/v1/admin/notices")
                                                        .header(
                                                                HttpHeaders.AUTHORIZATION,
                                                                bearer(token))
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content(
                                                                """
                                                                {"title":"점검 안내","content":"본문",
                                                                 "startsAt":"2026-10-23T09:00:00+09:00",
                                                                 "endsAt":"2026-10-30T04:00:00+09:00"}\
                                                                """))
                                        .andExpect(status().isCreated())
                                        .andExpect(jsonPath("$.adminName").value("검증 운영자"))
                                        .andExpect(
                                                jsonPath("$.endsAt")
                                                        .value("2026-10-30T04:00:00+09:00"))
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString(StandardCharsets.UTF_8))
                        .get("id")
                        .asLong();

        // 제목만 보내면 나머지는 그대로
        patchNotice(token, id, "{\"title\":\"점검 안내(시간 변경)\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("점검 안내(시간 변경)"))
                .andExpect(jsonPath("$.content").value("본문"))
                .andExpect(jsonPath("$.endsAt").value("2026-10-30T04:00:00+09:00"));
        // endsAt을 null로 보내면 지운다(종료 없이 계속)
        patchNotice(token, id, "{\"endsAt\":null}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.endsAt").isEmpty())
                .andExpect(jsonPath("$.title").value("점검 안내(시간 변경)"));
        patchNotice(token, id, "{\"title\":\"   \"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("title"));

        mvc.perform(
                        get("/api/v1/admin/notices/" + id)
                                .header(HttpHeaders.AUTHORIZATION, bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("본문"))
                // DB에서 다시 읽어도 한국 시간 오프셋으로 준다(관리 페이지가 문자열을 그대로 자른다)
                .andExpect(jsonPath("$.startsAt").value("2026-10-23T09:00:00+09:00"))
                .andExpect(jsonPath("$.endsAt").isEmpty());
        JsonNode first =
                json.readTree(
                                mvc.perform(
                                                get("/api/v1/admin/notices")
                                                        .header(
                                                                HttpHeaders.AUTHORIZATION,
                                                                bearer(token)))
                                        .andExpect(status().isOk())
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString(StandardCharsets.UTF_8))
                        .get("content")
                        .get(0);
        // 최근 작성순 맨 위이고 본문은 목록에 없다
        assertThat(first.get("id").asLong()).isEqualTo(id);
        assertThat(first.has("content")).isFalse();
    }

    @Test
    void deletedNoticeLeavesListsAndIsNotFound() throws Exception {
        long user = newUser();
        String token = login();
        long id =
                json.readTree(
                                mvc.perform(
                                                post("/api/v1/admin/notices")
                                                        .header(
                                                                HttpHeaders.AUTHORIZATION,
                                                                bearer(token))
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content(
                                                                """
                                                                {"title":"지울 공지","content":"본문",
                                                                 "startsAt":"2026-01-01T00:00:00+09:00"}\
                                                                """))
                                        .andExpect(status().isCreated())
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString(StandardCharsets.UTF_8))
                        .get("id")
                        .asLong();
        assertThat(noticeIds(body(asUser(user, get("/api/v1/notices"))))).contains(id);

        mvc.perform(
                        delete("/api/v1/admin/notices/" + id)
                                .header(HttpHeaders.AUTHORIZATION, bearer(token)))
                .andExpect(status().isNoContent());

        assertThat(noticeIds(body(asUser(user, get("/api/v1/notices"))))).doesNotContain(id);
        mvc.perform(
                        get("/api/v1/admin/notices/" + id)
                                .header(HttpHeaders.AUTHORIZATION, bearer(token)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOTICE_NOT_FOUND"));
        mvc.perform(
                        delete("/api/v1/admin/notices/" + id)
                                .header(HttpHeaders.AUTHORIZATION, bearer(token)))
                .andExpect(status().isNotFound());
        patchNotice(token, id, "{\"title\":\"바꿈\"}").andExpect(status().isNotFound());
        // 행은 남는다(soft delete)
        assertThat(
                        jdbc.queryForObject(
                                "SELECT deleted_at IS NOT NULL FROM notices WHERE id = ?",
                                Boolean.class,
                                id))
                .isTrue();
    }

    @Test
    void createNoticeRequiresTitleContentAndStart() throws Exception {
        String token = login();

        mvc.perform(
                        post("/api/v1/admin/notices")
                                .header(HttpHeaders.AUTHORIZATION, bearer(token))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"title\":\"\",\"content\":\" \"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(
                        jsonPath("$.errors[*].field")
                                .value(containsInAnyOrder("title", "content", "startsAt")));
    }

    private ResultActions patchNotice(String token, long id, String body) throws Exception {
        return mvc.perform(
                patch("/api/v1/admin/notices/" + id)
                        .header(HttpHeaders.AUTHORIZATION, bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body));
    }

    private static List<Long> noticeIds(JsonNode notices) {
        return notices.get("content").valueStream().map(n -> n.get("id").asLong()).toList();
    }

    private String login() throws Exception {
        return mvc.perform(
                        post("/api/v1/admin/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"loginId\":\"%s\",\"password\":\"%s\"}"
                                                .formatted(admin.getLoginId(), PASSWORD)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.admin.name").value("검증 운영자"))
                .andReturn()
                .getResponse()
                .getContentAsString(StandardCharsets.UTF_8)
                .transform(json::readTree)
                .get("accessToken")
                .asString();
    }

    private ResultActions grant(
            String token,
            String targetType,
            List<Long> ids,
            LocalDate grantDate,
            LocalDate fillable)
            throws Exception {
        return grant(token, targetType, ids, grantDate, fillable, 1);
    }

    private ResultActions grant(
            String token,
            String targetType,
            List<Long> ids,
            LocalDate grantDate,
            LocalDate fillable,
            int quantity)
            throws Exception {
        String userIds = ids == null ? "null" : ids.toString();
        return mvc.perform(
                post("/api/v1/admin/streak-freeze-grants")
                        .header(HttpHeaders.AUTHORIZATION, bearer(token))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                """
                                {"targetType":"%s","userIds":%s,"quantity":%d,
                                 "grantDate":"%s","fillableDate":"%s","reason":"검증"}\
                                """
                                        .formatted(
                                                targetType,
                                                userIds,
                                                quantity,
                                                grantDate,
                                                fillable)));
    }

    private ResultActions use(long user, long freezeId) throws Exception {
        return mvc.perform(
                asUser(user, post("/api/v1/users/me/streak-freezes/use"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"freezeId\":" + freezeId + "}"));
    }

    private JsonNode body(MockHttpServletRequestBuilder request) throws Exception {
        return json.readTree(
                mvc.perform(request)
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8));
    }

    private long newUser() {
        long id =
                users.saveAndFlush(
                                new User(
                                        "admin-it-" + UUID.randomUUID() + "@example.com",
                                        "hash",
                                        "관리 검증"))
                        .getId();
        userIds.add(id);
        return id;
    }

    // 회원 API는 실제 회원 토큰으로 부른다(디코더 검증을 거친다)
    private MockHttpServletRequestBuilder asUser(
            long userId, MockHttpServletRequestBuilder request) {
        return request.header(
                HttpHeaders.AUTHORIZATION, bearer(accessTokens.issue(userId, "관리 검증")));
    }

    private static String bearer(String token) {
        return "Bearer " + token;
    }
}
