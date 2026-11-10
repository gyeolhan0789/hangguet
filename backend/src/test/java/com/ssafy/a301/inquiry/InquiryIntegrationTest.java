package com.ssafy.a301.inquiry;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.is;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.admin.config.AdminPasswordEncoder;
import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.repository.AdminRepository;
import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.auth.repository.RefreshTokenStore;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL · Redis로 9. 문의 API를 확인한다. 비회원 · 회원 문의의 접근 규칙(없는 문의 · 남의 문의 · 틀린 조회 비밀번호는 모두 404),
 * 상태 전이(답변 대기 → 답변함 → 종료, 종료 뒤 쓰기 409), 제목 · 본문 암호화 저장, 관리자 비밀번호 변경(기록 · 모든 기기 로그아웃)을 본다. 토큰은 실제로
 * 발급해 디코더 검증을 거친다. 만든 데이터만 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class InquiryIntegrationTest {
    private static final String ADMIN_PASSWORD = "inquiry-it-admin";
    private static final String ACCESS = "X-Inquiry-Password";

    @Autowired private MockMvc mvc;
    @Autowired private AdminRepository admins;
    @Autowired private AdminPasswordEncoder adminPasswords;
    @Autowired private UserRepository users;
    @Autowired private PasswordEncoder passwords;
    @Autowired private AccessTokens accessTokens;
    @Autowired private RefreshTokenStore refreshTokens;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private StringRedisTemplate redis;
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<Long> userIds = new ArrayList<>();
    private final List<Long> inquiryIds = new ArrayList<>();
    private Admin admin;

    @BeforeEach
    void createAdmin() {
        admin =
                admins.saveAndFlush(
                        new Admin(
                                "inquiry-it-" + UUID.randomUUID(),
                                adminPasswords.encode(ADMIN_PASSWORD),
                                "문의 운영자"));
    }

    @AfterEach
    void cleanup() {
        for (long id : inquiryIds) {
            redis.delete("inquiry-fail:" + id);
            jdbc.update("DELETE FROM password_changes WHERE inquiry_id = ?", id);
            jdbc.update("DELETE FROM inquiry_messages WHERE inquiry_id = ?", id);
            jdbc.update("DELETE FROM inquiries WHERE id = ?", id);
        }
        for (long id : userIds) {
            // 로그인 확인 · 토큰 폐기 확인에서 만든 리프레시 토큰도 지운다
            refreshTokens.revokeAll(id);
            jdbc.update("DELETE FROM password_changes WHERE user_id = ?", id);
            jdbc.update("DELETE FROM users WHERE id = ?", id);
        }
        jdbc.update("DELETE FROM admins WHERE id = ?", admin.getId());
    }

    @Test
    void guestInquiryFollowsStatusFlowAndNeedsAccessPassword() throws Exception {
        long id =
                created(
                        mvc.perform(
                                        post("/api/v1/inquiries")
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content(
                                                        """
                                                        {"title":"비밀번호를 잊어버렸어요","content":"바꿔 주세요",
                                                         "email":"guest@example.com","accessPassword":"1234"}\
                                                        """))
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$.status").value("WAITING"))
                                .andExpect(jsonPath("$.title").value("비밀번호를 잊어버렸어요"))
                                .andExpect(jsonPath("$.messages.length()").value(1))
                                .andExpect(jsonPath("$.messages[0].authorType").value("USER")));

        // 조회 비밀번호가 없거나 틀리면 없는 문의와 같다
        mvc.perform(get("/api/v1/inquiries/" + id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("INQUIRY_NOT_FOUND"));
        mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "9999"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "1234"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.messages[0].content").value("바꿔 주세요"));

        message(post("/api/v1/inquiries/" + id + "/messages").header(ACCESS, "1234"), "더 있어요")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorType").value("USER"));
        message(asAdmin(post("/api/v1/admin/inquiries/" + id + "/messages")), "바꿨어요")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.authorType").value("ADMIN"))
                .andExpect(jsonPath("$.adminName").value("문의 운영자"));
        mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "1234"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ANSWERED"))
                .andExpect(
                        jsonPath("$.messages[*].content")
                                .value(contains("바꿔 주세요", "더 있어요", "바꿨어요")));

        // 문의한 사람이 다시 쓰면 답변 대기
        message(post("/api/v1/inquiries/" + id + "/messages").header(ACCESS, "1234"), "확인했어요")
                .andExpect(status().isCreated());
        mvc.perform(asAdmin(get("/api/v1/admin/inquiries/" + id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("WAITING"))
                .andExpect(jsonPath("$.userId").isEmpty())
                .andExpect(jsonPath("$.nickname").isEmpty())
                .andExpect(jsonPath("$.email").value("guest@example.com"))
                .andExpect(jsonPath("$.messages.length()").value(4));

        // 종료하면 누구도 더 쓸 수 없고, 다시 종료해도 204
        mvc.perform(post("/api/v1/inquiries/" + id + "/close").header(ACCESS, "1234"))
                .andExpect(status().isNoContent());
        message(post("/api/v1/inquiries/" + id + "/messages").header(ACCESS, "1234"), "또")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INQUIRY_CLOSED"));
        message(asAdmin(post("/api/v1/admin/inquiries/" + id + "/messages")), "또")
                .andExpect(status().isConflict());
        mvc.perform(asAdmin(post("/api/v1/admin/inquiries/" + id + "/close")))
                .andExpect(status().isNoContent());
        mvc.perform(post("/api/v1/inquiries/" + id + "/close").header(ACCESS, "0000"))
                .andExpect(status().isNotFound());
    }

    @Test
    void titleAndContentAreStoredEncrypted() throws Exception {
        long id =
                created(
                        mvc.perform(
                                post("/api/v1/inquiries")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {"title":"평문 제목","content":"원하는 비밀번호는 secret99",
                                                 "email":"guest@example.com","accessPassword":"abcd"}\
                                                """)));

        Map<String, Object> row =
                jdbc.queryForMap(
                        "SELECT i.title, i.access_password_hash, m.content FROM inquiries i JOIN"
                                + " inquiry_messages m ON m.inquiry_id = i.id WHERE i.id = ?",
                        id);
        assertThat((String) row.get("title")).doesNotContain("평문 제목");
        assertThat((String) row.get("content")).doesNotContain("secret99");
        assertThat((String) row.get("access_password_hash")).isNotEqualTo("abcd");
        assertThat(passwords.matches("abcd", (String) row.get("access_password_hash"))).isTrue();
        // 읽을 때는 풀어서 준다
        mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "abcd"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("평문 제목"))
                .andExpect(jsonPath("$.messages[0].content").value("원하는 비밀번호는 secret99"));
    }

    // 기준: 비회원 문의 조회 비밀번호 무작위 대입 방어(5번 틀리면 15분 동안 맞는 비밀번호도 404)
    @Test
    void guestInquiryLocksAfterFiveWrongPasswords() throws Exception {
        long id = guestInquiry("1234");

        // 맞히면 센 횟수를 지우므로 4번 틀린 뒤 맞혀도 다시 처음부터 센다
        for (int i = 0; i < 4; i++) {
            mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "000" + i))
                    .andExpect(status().isNotFound());
        }
        mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "1234"))
                .andExpect(status().isOk());

        for (int i = 0; i < 5; i++) {
            mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "000" + i))
                    .andExpect(status().isNotFound());
        }
        // 잠긴 동안은 맞는 비밀번호도 없는 문의와 같고, 쓰기 · 종료도 막힌다
        mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "1234"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("INQUIRY_NOT_FOUND"));
        message(post("/api/v1/inquiries/" + id + "/messages").header(ACCESS, "1234"), "더 있어요")
                .andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/inquiries/" + id + "/close").header(ACCESS, "1234"))
                .andExpect(status().isNotFound());

        // 15분이 지나면(잠금 키가 사라지면) 다시 열린다
        redis.delete("inquiry-fail:" + id);
        mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "1234"))
                .andExpect(status().isOk());
    }

    // 기준: 문의 · 답변 본문 최대 2,000자(9.1 · 9.4 · 9.8)
    @Test
    void contentOver2000CharactersIsRejected() throws Exception {
        String tooLong = "가".repeat(2_001);
        mvc.perform(
                        post("/api/v1/inquiries")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"title":"길이","content":"%s",
                                         "email":"guest@example.com","accessPassword":"1234"}\
                                        """
                                                .formatted(tooLong)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("content"))
                .andExpect(jsonPath("$.errors[0].reason").value("최대 2,000자입니다."));

        long id = guestInquiry("1234");
        message(post("/api/v1/inquiries/" + id + "/messages").header(ACCESS, "1234"), tooLong)
                .andExpect(status().isBadRequest());
        message(asAdmin(post("/api/v1/admin/inquiries/" + id + "/messages")), tooLong)
                .andExpect(status().isBadRequest());
        message(
                        post("/api/v1/inquiries/" + id + "/messages").header(ACCESS, "1234"),
                        "가".repeat(2_000))
                .andExpect(status().isCreated());
    }

    @Test
    void guestCreateRequiresEmailAndAccessPassword() throws Exception {
        mvc.perform(
                        post("/api/v1/inquiries")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"title\":\"제목\",\"content\":\"내용\",\"accessPassword\":\"1234\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("email"));
        mvc.perform(
                        post("/api/v1/inquiries")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"title\":\"제목\",\"content\":\"내용\",\"email\":\"g@example.com\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("accessPassword"));
        mvc.perform(
                        post("/api/v1/inquiries")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        {"title":"","content":" ","email":"g@example.com","accessPassword":"123"}\
                                        """))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.errors[*].field")
                                .value(containsInAnyOrder("title", "content", "accessPassword")));
    }

    @Test
    void memberInquiryIsOnlyForThatMember() throws Exception {
        long owner = newUser();
        long other = newUser();
        long id =
                created(
                        mvc.perform(
                                        asUser(owner, post("/api/v1/inquiries"))
                                                .contentType(MediaType.APPLICATION_JSON)
                                                // 회원이면 보낸 email · accessPassword는 쓰지 않는다
                                                .content(
                                                        """
                                                        {"title":"질문이 반복돼요","content":"확인해 주세요",
                                                         "email":"other@example.com","accessPassword":"1234"}\
                                                        """))
                                .andExpect(status().isCreated()));

        mvc.perform(asUser(owner, get("/api/v1/inquiries")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(id))
                .andExpect(jsonPath("$.content[0].messages").doesNotExist());
        mvc.perform(asUser(other, get("/api/v1/inquiries")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0));
        mvc.perform(get("/api/v1/inquiries")).andExpect(status().isUnauthorized());

        mvc.perform(asUser(other, get("/api/v1/inquiries/" + id))).andExpect(status().isNotFound());
        message(asUser(other, post("/api/v1/inquiries/" + id + "/messages")), "남의 문의")
                .andExpect(status().isNotFound());
        mvc.perform(asUser(other, post("/api/v1/inquiries/" + id + "/close")))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/inquiries/" + id).header(ACCESS, "1234"))
                .andExpect(status().isNotFound());
        // 다른 회원의 쓰기 · 종료는 반영되지 않았다
        mvc.perform(asUser(owner, get("/api/v1/inquiries/" + id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("질문이 반복돼요"))
                .andExpect(jsonPath("$.status").value("WAITING"))
                .andExpect(jsonPath("$.messages.length()").value(1));

        mvc.perform(asAdmin(get("/api/v1/admin/inquiries/" + id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(owner))
                .andExpect(jsonPath("$.nickname").value("문의 검증"))
                .andExpect(
                        jsonPath("$.email").value(users.findById(owner).orElseThrow().getEmail()));
        long closed =
                created(
                        mvc.perform(
                                asUser(owner, post("/api/v1/inquiries"))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{\"title\":\"끝난 문의\",\"content\":\"내용\"}")));
        mvc.perform(asUser(owner, post("/api/v1/inquiries/" + closed + "/close")))
                .andExpect(status().isNoContent());
        String mine = "$.content[?(@.id == %d)]";
        mvc.perform(
                        asAdmin(get("/api/v1/admin/inquiries"))
                                .param("status", "WAITING")
                                .param("size", "20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].status", everyItem(is("WAITING"))))
                .andExpect(jsonPath(mine.formatted(id)).isNotEmpty())
                .andExpect(jsonPath(mine.formatted(closed)).isEmpty());
        mvc.perform(
                        asAdmin(get("/api/v1/admin/inquiries"))
                                .param("status", "CLOSED")
                                .param("size", "20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[*].status", everyItem(is("CLOSED"))))
                .andExpect(jsonPath(mine.formatted(closed)).isNotEmpty())
                .andExpect(jsonPath(mine.formatted(id)).isEmpty());
        // 상태를 보내지 않으면 전부, 최근 작성순(나중에 만든 closed가 앞)
        mvc.perform(asAdmin(get("/api/v1/admin/inquiries")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(closed))
                .andExpect(jsonPath("$.content[1].id").value(id))
                .andExpect(jsonPath("$.content[1].userId").value(owner));
        mvc.perform(asAdmin(get("/api/v1/admin/inquiries/0")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("INQUIRY_NOT_FOUND"));
    }

    @Test
    void adminChangesPasswordRecordsItAndSignsOutEveryDevice() throws Exception {
        long user = newUser();
        long inquiry =
                created(
                        mvc.perform(
                                asUser(user, post("/api/v1/inquiries"))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content("{\"title\":\"비밀번호\",\"content\":\"바꿔 주세요\"}")));
        String phone = refreshTokens.issue(user);
        String laptop = refreshTokens.issue(user);

        changePassword(user, "{\"newPassword\":\"efgh5678\",\"inquiryId\":" + inquiry + "}")
                .andExpect(status().isNoContent());

        String email = users.findById(user).orElseThrow().getEmail();
        mvc.perform(
                        post("/api/v1/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"email\":\"%s\",\"password\":\"efgh5678\"}"
                                                .formatted(email)))
                .andExpect(status().isOk());
        mvc.perform(
                        post("/api/v1/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"email\":\"%s\",\"password\":\"abcd1234\"}"
                                                .formatted(email)))
                .andExpect(status().isUnauthorized());
        assertThat(refreshTokens.consume(phone)).isNull();
        assertThat(refreshTokens.consume(laptop)).isNull();
        Map<String, Object> change =
                jdbc.queryForMap(
                        "SELECT changed_by, admin_id, inquiry_id FROM password_changes WHERE"
                                + " user_id = ?",
                        user);
        assertThat(change).containsEntry("changed_by", "ADMIN");
        assertThat(((Number) change.get("admin_id")).longValue()).isEqualTo(admin.getId());
        assertThat(((Number) change.get("inquiry_id")).longValue()).isEqualTo(inquiry);

        changePassword(0, "{\"newPassword\":\"efgh5678\"}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        changePassword(user, "{\"newPassword\":\"efgh5678\",\"inquiryId\":0}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("INQUIRY_NOT_FOUND"));
        long withdrawn = newUser();
        jdbc.update("UPDATE users SET deleted_at = now() WHERE id = ?", withdrawn);
        changePassword(withdrawn, "{\"newPassword\":\"efgh5678\"}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        changePassword(user, "{\"newPassword\":\"abcdefgh\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("newPassword"));
        // 회원 토큰으로는 관리자 API를 부를 수 없다
        mvc.perform(
                        asUser(user, patch("/api/v1/admin/users/" + user + "/password"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"newPassword\":\"efgh5678\"}"))
                .andExpect(status().isUnauthorized());
    }

    private ResultActions changePassword(long userId, String body) throws Exception {
        return mvc.perform(
                asAdmin(patch("/api/v1/admin/users/" + userId + "/password"))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body));
    }

    private ResultActions message(MockHttpServletRequestBuilder request, String content)
            throws Exception {
        return mvc.perform(
                request.contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"%s\"}".formatted(content)));
    }

    // 만든 문의 id를 기억해 두었다가 지운다
    private long created(ResultActions result) throws Exception {
        long id =
                json.readTree(
                                result.andExpect(status().isCreated())
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString(StandardCharsets.UTF_8))
                        .get("id")
                        .asLong();
        inquiryIds.add(id);
        return id;
    }

    private long newUser() {
        long id =
                users.saveAndFlush(
                                new User(
                                        "inquiry-it-" + UUID.randomUUID() + "@example.com",
                                        passwords.encode("abcd1234"),
                                        "문의 검증"))
                        .getId();
        userIds.add(id);
        return id;
    }

    // 회원 API는 실제 회원 토큰으로 부른다(디코더 검증을 거친다)
    private MockHttpServletRequestBuilder asUser(
            long userId, MockHttpServletRequestBuilder request) {
        return request.header(
                HttpHeaders.AUTHORIZATION, "Bearer " + accessTokens.issue(userId, "문의 검증"));
    }

    private MockHttpServletRequestBuilder asAdmin(MockHttpServletRequestBuilder request)
            throws Exception {
        String token =
                json.readTree(
                                mvc.perform(
                                                post("/api/v1/admin/auth/login")
                                                        .contentType(MediaType.APPLICATION_JSON)
                                                        .content(
                                                                "{\"loginId\":\"%s\",\"password\":\"%s\"}"
                                                                        .formatted(
                                                                                admin.getLoginId(),
                                                                                ADMIN_PASSWORD)))
                                        .andExpect(status().isOk())
                                        .andReturn()
                                        .getResponse()
                                        .getContentAsString(StandardCharsets.UTF_8))
                        .get("accessToken")
                        .asString();
        return request.header(HttpHeaders.AUTHORIZATION, "Bearer " + token);
    }

    private long guestInquiry(String accessPassword) throws Exception {
        return created(
                mvc.perform(
                                post("/api/v1/inquiries")
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                """
                                                {"title":"잠금 확인","content":"내용",
                                                 "email":"guest@example.com","accessPassword":"%s"}\
                                                """
                                                        .formatted(accessPassword)))
                        .andExpect(status().isCreated()));
    }
}
