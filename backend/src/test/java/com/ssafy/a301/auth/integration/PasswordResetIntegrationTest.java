package com.ssafy.a301.auth.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.auth.repository.PasswordResetTokenStore;
import com.ssafy.a301.auth.repository.RefreshTokenStore;
import com.ssafy.a301.common.crypto.Hashes;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
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

/**
 * 실제 PostgreSQL · Redis로 비밀번호 찾기(1.8 · 1.9)를 확인한다. 메일 발송은 PasswordResetMailerTest가 보고, 여기서는 메일 링크의
 * 토큰을 저장소에서 직접 만들어 쓴다(다른 통합 테스트와 같은 Spring 컨텍스트를 쓰려고 메일 대역을 두지 않는다). 만든 데이터만 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class PasswordResetIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private UserRepository users;
    @Autowired private PasswordEncoder passwords;
    @Autowired private AccessTokens accessTokens;
    @Autowired private RefreshTokenStore refreshTokens;
    @Autowired private PasswordResetTokenStore resetTokens;
    @Autowired private StringRedisTemplate redis;
    @Autowired private JdbcTemplate jdbc;
    private final List<User> created = new ArrayList<>();
    private final List<String> emails = new ArrayList<>();

    @AfterEach
    void cleanup() {
        for (String email : emails) {
            String hash = Hashes.sha256Hex(email);
            redis.delete(List.of("password-reset-wait:" + hash, "login-fail:" + hash));
        }
        for (User user : created) {
            refreshTokens.revokeAll(user.getId());
            jdbc.update("DELETE FROM password_changes WHERE user_id = ?", user.getId());
            jdbc.update("DELETE FROM users WHERE id = ?", user.getId());
        }
    }

    @Test
    void linkChangesPasswordOnceLogsOutEveryDeviceAndUnlocksLogin() throws Exception {
        User user = emailUser();
        String oldAccess = accessTokens.issue(user.getId(), user.getNickname());
        for (int i = 0; i < 5; i++) {
            login(user.getEmail(), "wrongPass1234").andExpect(status().isUnauthorized());
        }
        login(user.getEmail(), "testPass1234").andExpect(status().isTooManyRequests());
        // 발급 시각(iat)은 초 단위라 같은 초 안에 바꾸면 기존 토큰과 구분하지 못한다
        Thread.sleep(1_100);
        String token = resetTokens.issue(user.getId());

        confirm(token, "newPass5678").andExpect(status().isNoContent());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT changed_by FROM password_changes WHERE user_id = ?",
                                String.class,
                                user.getId()))
                .isEqualTo("RESET");
        // 같은 링크는 다시 쓸 수 없다
        confirm(token, "other5678")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PASSWORD_RESET_TOKEN_INVALID"));
        // 바꾸기 전 액세스 토큰은 401, 잠금은 풀리고 옛 비밀번호는 실패, 새 비밀번호로 로그인
        mvc.perform(
                        get("/api/v1/users/me")
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + oldAccess))
                .andExpect(status().isUnauthorized());
        login(user.getEmail(), "testPass1234").andExpect(status().isUnauthorized());
        login(user.getEmail(), "newPass5678").andExpect(status().isOk());
    }

    @Test
    void olderLinkCannotBeUsedAfterPasswordChangedWithAnotherLink() throws Exception {
        User user = emailUser();
        String first = resetTokens.issue(user.getId());
        Thread.sleep(5);
        String second = resetTokens.issue(user.getId());

        confirm(second, "newPass5678").andExpect(status().isNoContent());
        confirm(first, "other5678")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PASSWORD_RESET_TOKEN_INVALID"));
    }

    @Test
    void requestIsAlwaysNoContentAndStartsResendIntervalForAnyEmail() throws Exception {
        User user = emailUser();
        String unknown = "reset-it-none-" + UUID.randomUUID() + "@example.com";
        emails.add(unknown);
        User social = users.saveAndFlush(User.social(randomEmail(), "카카오"));
        created.add(social);

        for (String email :
                List.of(user.getEmail().toUpperCase(Locale.ROOT), unknown, social.getEmail())) {
            requestReset(email).andExpect(status().isNoContent());
            // 간격 안의 재요청도 같은 204
            requestReset(email).andExpect(status().isNoContent());
            assertThat(
                            redis.hasKey(
                                    "password-reset-wait:"
                                            + Hashes.sha256Hex(User.normalizeEmail(email))))
                    .isTrue();
        }
    }

    private User emailUser() {
        User user =
                users.saveAndFlush(
                        new User(randomEmail(), passwords.encode("testPass1234"), "재설정 검증"));
        created.add(user);
        return user;
    }

    private String randomEmail() {
        String email = "reset-it-" + UUID.randomUUID() + "@example.com";
        emails.add(email);
        return email;
    }

    private ResultActions requestReset(String email) throws Exception {
        return mvc.perform(
                post("/api/v1/auth/password-reset")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"%s\"}".formatted(email)));
    }

    private ResultActions confirm(String token, String newPassword) throws Exception {
        return mvc.perform(
                post("/api/v1/auth/password-reset/confirm")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                "{\"token\":\"%s\",\"newPassword\":\"%s\"}"
                                        .formatted(token, newPassword)));
    }

    private ResultActions login(String email, String password) throws Exception {
        return mvc.perform(
                post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(
                                "{\"email\":\"%s\",\"password\":\"%s\"}"
                                        .formatted(email, password)));
    }
}
