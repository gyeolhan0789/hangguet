package com.ssafy.a301.admin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.admin.config.AdminPasswordEncoder;
import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.repository.AdminRepository;
import com.ssafy.a301.admin.service.AdminDailyMetricService;
import com.ssafy.a301.admin.service.AdminMetricsService;
import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL로 8.16 관리자 일별 메트릭을 확인한다. 기록 날짜는 실제 데이터가 없는 2001년이라 날짜로 정해지는 값(가입 · 연습 · 재방문)을 정확히
 * 센다. 상태가 바뀌는 값(회원 · 면접 · 문의 · 유지권 수)은 공유 DB라 같은 시각의 8.15 집계와 같은지만 본다. 만든 데이터만 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class AdminDailyMetricIntegrationTest {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final String PASSWORD = "admin-daily-it-pass";
    private static final LocalDate DAY = LocalDate.of(2001, 3, 10);

    @Autowired private MockMvc mvc;
    @Autowired private AdminRepository admins;
    @Autowired private UserRepository users;
    @Autowired private AdminPasswordEncoder passwords;
    @Autowired private AdminDailyMetricService daily;
    @Autowired private AdminMetricsService metrics;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private AccessTokens accessTokens;
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<Long> userIds = new ArrayList<>();
    private final List<LocalDate> metricDates = new ArrayList<>();
    private Admin admin;

    @AfterEach
    void cleanup() {
        for (LocalDate date : metricDates) {
            jdbc.update("DELETE FROM admin_daily_metrics WHERE metric_date = ?", date);
        }
        for (long id : userIds) {
            String sessions = "SELECT id FROM interview_sessions WHERE user_id = ?";
            jdbc.update("DELETE FROM ai_job_outbox WHERE session_id IN (" + sessions + ")", id);
            jdbc.update("DELETE FROM interview_sessions WHERE user_id = ?", id);
            jdbc.update("DELETE FROM applications WHERE user_id = ?", id);
            jdbc.update("DELETE FROM practice_logs WHERE user_id = ?", id);
            jdbc.update("DELETE FROM users WHERE id = ?", id);
        }
        if (admin != null) {
            jdbc.update("DELETE FROM admins WHERE id = ?", admin.getId());
        }
    }

    /**
     * 3.10 기록. 경계마다 한 명씩 둔다: 한국 시간 0시 · 23시대 가입(UTC로는 다른 날), 탈퇴 회원, 주간 첫날 · 그 전날 연습, 재방문 정확히 N일째 vs
     * 다른 날. 칸마다 기대값이 달라 두 칸이 바뀌어도 깨진다.
     */
    @Test
    void recordCountsDayBasedMetricsOfThatDayIntoTheirOwnColumns() {
        // 3.9 가입 · 3.10 연습 → D1 대상 · 돌아옴
        practiced(joinedOn(DAY.minusDays(1), 12), DAY);
        // 3.9 가입 · 연습 없음 → D1 대상만
        joinedOn(DAY.minusDays(1), 12);
        // 3.9 0시 30분(UTC 3.8) 가입 · 3.10 연습 → D1 대상 · 돌아옴. 가입일을 한국 날짜로 바꾸지 않으면 3.8이 돼 돌아오지 않은 것이 된다
        practiced(joinedOn(DAY.minusDays(1), 0, 30), DAY);
        // 3.9 가입 · 3.10 연습 뒤 탈퇴 → 재방문은 탈퇴 회원도 센다(D1 대상 · 돌아옴)
        long withdrawn = joinedOn(DAY.minusDays(1), 12);
        practiced(withdrawn, DAY);
        withdraw(withdrawn);
        // 3.10 0시 30분 · 23시 30분 가입 → 그날 가입 2명(UTC 기준이면 0시 30분이 빠진다)
        joinedOn(DAY, 0, 30);
        joinedOn(DAY, 23, 30);
        // 3.10 가입 뒤 탈퇴 → 그날 가입에 들지 않는다
        withdraw(joinedOn(DAY, 12));
        // 3.11 가입 → 다음 날이라 그날 가입에 들지 않는다
        joinedOn(DAY.plusDays(1), 12);
        // 3.3 가입 · 3.6(3일째) 연습 → D1 · D3 · D7 대상, D3만 돌아옴. 3.6은 주간(3.4~3.10) 안
        practiced(joinedOn(DAY.minusDays(7), 12), DAY.minusDays(4));
        // 3.7 가입 · 연습 없음 → D1 · D3 대상(3.7은 D3 마지막 가입일)
        joinedOn(DAY.minusDays(3), 12);
        // 2.20 가입 · 3.4(주간 첫날) 연습 → 주간에 든다. 재방문은 모두 대상, 돌아오지 않음
        practiced(joinedOn(LocalDate.of(2001, 2, 20), 12), DAY.minusDays(6));
        // 2.20 가입 · 3.3(주간 전날)에만 연습 → 주간에 들지 않는다
        practiced(joinedOn(LocalDate.of(2001, 2, 20), 12), DAY.minusDays(7));

        record(DAY, OffsetDateTime.now(KST));

        assertThat(row(DAY))
                .containsEntry("users_joined", 2)
                .containsEntry("practiced_users", 3)
                .containsEntry("practiced_week", 5)
                .containsEntry("d1_eligible", 8)
                .containsEntry("d1_returned", 3)
                .containsEntry("d3_eligible", 4)
                .containsEntry("d3_returned", 1)
                .containsEntry("d7_eligible", 3)
                .containsEntry("d7_returned", 0);
    }

    // 분석 중인데 마지막 결과 요청(EVALUATE)이 최대 대기 시간(10분) 전이면 멈춘 면접. 경계(정확히 10분 전)는 멈춘 것으로 센다
    @Test
    void stuckCountsAnalysesWhoseLatestEvaluateIsAtLeastTimeoutOld() {
        OffsetDateTime now = OffsetDateTime.now(KST).withNano(0);
        int before = metrics.metrics(DAY, now).interviews().stuck();
        long user = joinedOn(DAY, 12);
        long application = application(user);
        // 정확히 10분 전 → 멈춤
        evaluate(session(user, application, "ANALYZING"), now.minusMinutes(10));
        // 9분 59초 전 → 아직 기다리는 중
        evaluate(session(user, application, "ANALYZING"), now.minusMinutes(10).plusSeconds(1));
        // 1시간 전 요청 뒤 방금 다시 요청 → 마지막 요청 기준이라 기다리는 중
        long retried = session(user, application, "ANALYZING");
        evaluate(retried, now.minusHours(1));
        evaluate(retried, now);
        // 오래됐지만 결과가 나온 면접 → 세지 않는다
        evaluate(session(user, application, "COMPLETED"), now.minusHours(1));

        assertThat(metrics.metrics(DAY, now).interviews().stuck() - before).isEqualTo(1);
    }

    @Test
    void recordAgainOverwritesButStartupFillKeepsExistingRow() {
        OffsetDateTime first = DAY.plusDays(1).atStartOfDay(KST).toOffsetDateTime();
        record(DAY, first);
        jdbc.update("UPDATE admin_daily_metrics SET users_total = -1 WHERE metric_date = ?", DAY);

        // 기동 때 채우기는 전날(3.10) 기록이 있으면 그대로 둔다
        assertThat(daily.recordYesterdayIfAbsent(first.plusHours(9))).isFalse();
        assertThat(row(DAY)).containsEntry("users_total", -1);

        // 0시 기록은 같은 날을 덮어쓴다(기록 시각도 바뀐다)
        OffsetDateTime second = first.plusMinutes(5);
        daily.record(DAY, second);
        assertThat(row(DAY))
                .containsEntry("users_total", metrics.metrics(DAY, second).users().total());
        assertThat(recordedAt(DAY)).isEqualTo(second.toInstant());

        // 전날 기록이 없으면 기동 때 남긴다
        jdbc.update("DELETE FROM admin_daily_metrics WHERE metric_date = ?", DAY);
        assertThat(daily.recordYesterdayIfAbsent(first.plusHours(9))).isTrue();
        assertThat(row(DAY)).isNotEmpty();
    }

    @Test
    void dailyApiReturnsOnlyRecordsUpToYesterdayWithinDaysOldestFirst() throws Exception {
        LocalDate today = LocalDate.now(KST);
        // days=300이면 어제부터 300일: today-300 ~ today-1
        LocalDate inside = today.minusDays(300);
        LocalDate outside = today.minusDays(301);
        LocalDate older = today.minusDays(302);
        insert(inside, 11);
        insert(outside, 22);
        insert(older, 33);
        String token = login();

        List<String> dates300 = dates(token, 300);
        assertThat(dates300)
                .contains(inside.toString())
                .doesNotContain(outside.toString(), older.toString());

        String body =
                mvc.perform(
                                get("/api/v1/admin/metrics/daily?days=365")
                                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.from").value(today.minusDays(365).toString()))
                        .andExpect(jsonPath("$.to").value(today.minusDays(1).toString()))
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        List<String> dates365 =
                json.readTree(body)
                        .get("content")
                        .valueStream()
                        .map(d -> d.get("date").asString())
                        .filter(
                                d ->
                                        d.equals(inside.toString())
                                                || d.equals(outside.toString())
                                                || d.equals(older.toString()))
                        .toList();
        assertThat(dates365)
                .containsExactly(older.toString(), outside.toString(), inside.toString());
        // 칸마다 다른 값을 넣어 응답 필드가 제 칸을 읽는지 본다
        JsonNode item =
                json.readTree(body)
                        .get("content")
                        .valueStream()
                        .filter(d -> d.get("date").asString().equals(inside.toString()))
                        .findFirst()
                        .orElseThrow();
        assertThat(item.get("usersTotal").asInt()).isEqualTo(11);
        assertThat(item.get("usersJoined").asInt()).isEqualTo(12);
        assertThat(item.get("usersWithdrawn").asInt()).isEqualTo(13);
        assertThat(item.get("usersInterviewed").asInt()).isEqualTo(14);
        assertThat(item.get("practicedUsers").asInt()).isEqualTo(15);
        assertThat(item.get("practicedWeek").asInt()).isEqualTo(16);
        assertThat(item.get("d1Eligible").asInt()).isEqualTo(17);
        assertThat(item.get("d1Returned").asInt()).isEqualTo(18);
        assertThat(item.get("d3Eligible").asInt()).isEqualTo(19);
        assertThat(item.get("d3Returned").asInt()).isEqualTo(20);
        assertThat(item.get("d7Eligible").asInt()).isEqualTo(21);
        assertThat(item.get("d7Returned").asInt()).isEqualTo(22);
        assertThat(item.get("interviewsTotal").asInt()).isEqualTo(23);
        assertThat(item.get("interviewsCompleted").asInt()).isEqualTo(24);
        assertThat(item.get("interviewsFailed").asInt()).isEqualTo(25);
        assertThat(item.get("interviewsAborted").asInt()).isEqualTo(26);
        assertThat(item.get("interviewsStuck").asInt()).isEqualTo(27);
        assertThat(item.get("applications").asInt()).isEqualTo(28);
        assertThat(item.get("inquiriesWaiting").asInt()).isEqualTo(29);
        assertThat(item.get("freezesGranted").asInt()).isEqualTo(30);
        assertThat(item.get("freezesUsed").asInt()).isEqualTo(31);
    }

    @Test
    void dailyApiAcceptsOneDayAsJustYesterday() throws Exception {
        LocalDate yesterday = LocalDate.now(KST).minusDays(1);
        mvc.perform(
                        get("/api/v1/admin/metrics/daily?days=1")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + login()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.from").value(yesterday.toString()))
                .andExpect(jsonPath("$.to").value(yesterday.toString()));
    }

    @Test
    void dailyApiIsForAdminsOnly() throws Exception {
        long user = joinedOn(DAY, 12);
        mvc.perform(
                        get("/api/v1/admin/metrics/daily")
                                .header(
                                        HttpHeaders.AUTHORIZATION,
                                        "Bearer " + accessTokens.issue(user, "회원")))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void dailyApiRejectsDaysOutsideOneTo365() throws Exception {
        String token = login();
        for (String days : List.of("0", "366")) {
            mvc.perform(
                            get("/api/v1/admin/metrics/daily?days=" + days)
                                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        }
    }

    private void record(LocalDate date, OffsetDateTime now) {
        metricDates.add(date);
        daily.record(date, now);
    }

    private Map<String, Object> row(LocalDate date) {
        List<Map<String, Object>> rows =
                jdbc.queryForList("SELECT * FROM admin_daily_metrics WHERE metric_date = ?", date);
        return rows.isEmpty() ? Map.of() : rows.get(0);
    }

    private Instant recordedAt(LocalDate date) {
        return jdbc.queryForObject(
                        "SELECT recorded_at FROM admin_daily_metrics WHERE metric_date = ?",
                        Timestamp.class,
                        date)
                .toInstant();
    }

    // usersTotal부터 freezesUsed까지 base, base+1, … 로 칸마다 다른 값을 넣는다
    private void insert(LocalDate date, int base) {
        metricDates.add(date);
        Object[] args = new Object[23];
        args[0] = date;
        for (int i = 1; i <= 21; i++) {
            args[i] = base + i - 1;
        }
        args[22] = date.plusDays(1).atStartOfDay(KST).toOffsetDateTime();
        jdbc.update(
                """
                INSERT INTO admin_daily_metrics (metric_date, users_total, users_joined, users_withdrawn,
                    users_interviewed, practiced_users, practiced_week, d1_eligible, d1_returned,
                    d3_eligible, d3_returned, d7_eligible, d7_returned, interviews_total,
                    interviews_completed, interviews_failed, interviews_aborted, interviews_stuck,
                    applications, inquiries_waiting, freezes_granted, freezes_used, recorded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                args);
    }

    private List<String> dates(String token, int days) throws Exception {
        String body =
                mvc.perform(
                                get("/api/v1/admin/metrics/daily?days=" + days)
                                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString(StandardCharsets.UTF_8);
        return json.readTree(body)
                .get("content")
                .valueStream()
                .map(d -> d.get("date").asString())
                .toList();
    }

    // 그날 한국 시간 hour:minute에 가입한 회원
    private long joinedOn(LocalDate date, int hour) {
        return joinedOn(date, hour, 0);
    }

    private long joinedOn(LocalDate date, int hour, int minute) {
        long id =
                users.saveAndFlush(
                                new User(
                                        "admin-daily-it-" + UUID.randomUUID() + "@example.com",
                                        "hash",
                                        "일별 검증"))
                        .getId();
        userIds.add(id);
        jdbc.update(
                "UPDATE users SET created_at = ? WHERE id = ?",
                date.atTime(hour, minute).atZone(KST).toOffsetDateTime(),
                id);
        return id;
    }

    private void withdraw(long userId) {
        jdbc.update("UPDATE users SET deleted_at = now() WHERE id = ?", userId);
    }

    private long application(long userId) {
        return jdbc.queryForObject(
                "INSERT INTO applications (user_id, company_name, job_title, created_at)"
                        + " VALUES (?, '검증 회사', '검증 직무', now()) RETURNING id",
                Long.class,
                userId);
    }

    private long session(long userId, long applicationId, String status) {
        return jdbc.queryForObject(
                "INSERT INTO interview_sessions (user_id, application_id, persona, mode, status,"
                        + " created_at) VALUES (?, ?, 'DEVIL', 'CHAT', ?, now()) RETURNING id",
                Long.class,
                userId,
                applicationId,
                status);
    }

    // 보낸 작업으로 넣어 발행 작업(AiJobPublisher)이 실제 큐로 보내지 않게 한다
    private void evaluate(long sessionId, OffsetDateTime createdAt) {
        jdbc.update(
                "INSERT INTO ai_job_outbox (id, job_type, session_id, created_at, published_at)"
                        + " VALUES (?, 'EVALUATE', ?, ?, now())",
                UUID.randomUUID(),
                sessionId,
                createdAt);
    }

    private void practiced(long userId, LocalDate date) {
        jdbc.update(
                "INSERT INTO practice_logs (user_id, practice_date, created_at) VALUES (?, ?,"
                        + " now())",
                userId,
                date);
    }

    private String login() throws Exception {
        admin =
                admins.saveAndFlush(
                        new Admin(
                                "daily-it-" + UUID.randomUUID(),
                                passwords.encode(PASSWORD),
                                "일별 검증 운영자"));
        return json.readTree(
                        mvc.perform(
                                        post("/api/v1/admin/auth/login")
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content(
                                                        "{\"loginId\":\"%s\",\"password\":\"%s\"}"
                                                                .formatted(
                                                                        admin.getLoginId(),
                                                                        PASSWORD)))
                                .andExpect(status().isOk())
                                .andReturn()
                                .getResponse()
                                .getContentAsString(StandardCharsets.UTF_8))
                .get("accessToken")
                .asString();
    }
}
