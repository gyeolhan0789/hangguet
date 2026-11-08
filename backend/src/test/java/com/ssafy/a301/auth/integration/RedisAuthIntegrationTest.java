package com.ssafy.a301.auth.integration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.offset;

import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.common.crypto.Hashes;
import com.ssafy.a301.user.domain.User;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 실제 HTTP → Spring Security → PostgreSQL·Redis 경로를 검증한다. 생성한 계정과 토큰만 정리한다. */
@Tag("redis-integration")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class RedisAuthIntegrationTest {
    @LocalServerPort private int port;
    @Autowired private StringRedisTemplate redis;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private AuthProperties properties;
    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<String> emails = new ArrayList<>();
    private final List<String> tokenKeys = new ArrayList<>();

    @AfterEach
    void cleanup() {
        if (!tokenKeys.isEmpty()) {
            redis.delete(tokenKeys);
        }
        for (String email : emails) {
            redis.delete(loginFailKey(email));
            jdbc.update(
                    "DELETE FROM password_changes WHERE user_id IN (SELECT id FROM users WHERE"
                            + " email = ?)",
                    email);
            jdbc.update(
                    "DELETE FROM user_agreements WHERE user_id IN (SELECT id FROM users WHERE email"
                            + " = ?)",
                    email);
            jdbc.update("DELETE FROM users WHERE email = ?", email);
        }
    }

    @Test
    void springBootConnectsToRedisAndHealthIsUp() throws Exception {
        try (var connection = redis.getConnectionFactory().getConnection()) {
            assertThat(connection.ping()).isEqualTo("PONG");
        }
        var response =
                http.send(
                        HttpRequest.newBuilder(uri("/actuator/health")).GET().build(),
                        HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(json.readTree(response.body()).path("status").asText()).isEqualTo("UP");
    }

    @Test
    void loginStoresRefreshTokenWithOwnerAndExpiry() throws Exception {
        Account account = signup();
        var response =
                post(
                        "/api/v1/auth/login",
                        Map.of("email", account.email(), "password", "testPass1234"),
                        null);
        assertThat(response.statusCode()).isEqualTo(200);
        JsonNode body = body(response);
        String token = remember(body.path("refreshToken").asText());
        String key = key(token);
        // 값은 "회원 id:로그인 시각(epoch 밀리초)"
        assertThat(redis.opsForValue().get(key)).startsWith(account.id() + ":");
        Long ttl = redis.getExpire(key, TimeUnit.SECONDS);
        assertThat(ttl).isPositive().isLessThanOrEqualTo(properties.refreshTtl().toSeconds());
        assertThat(redis.hasKey("refresh:" + token)).isFalse();
    }

    @Test
    void refreshRotatesAndOldTokenCannotBeReused() throws Exception {
        Account account = signup();
        String loggedIn = redis.opsForValue().get(key(account.refresh()));
        var response =
                post("/api/v1/auth/token/refresh", Map.of("refreshToken", account.refresh()), null);
        assertThat(response.statusCode()).isEqualTo(200);
        String next = remember(body(response).path("refreshToken").asText());
        assertThat(next.equals(account.refresh())).isFalse();
        assertThat(redis.hasKey(key(account.refresh()))).isFalse();
        // 재발급해도 로그인 시각은 이어진다
        assertThat(redis.opsForValue().get(key(next))).isEqualTo(loggedIn);
        var reused =
                post("/api/v1/auth/token/refresh", Map.of("refreshToken", account.refresh()), null);
        assertThat(reused.statusCode()).isEqualTo(401);
        assertThat(body(reused).path("code").asText()).isEqualTo("REFRESH_TOKEN_INVALID");
        var again = post("/api/v1/auth/token/refresh", Map.of("refreshToken", next), null);
        assertThat(again.statusCode()).isEqualTo(200);
        remember(body(again).path("refreshToken").asText());
    }

    @Test
    void passwordChangedByAdminAfterLoginBlocksRefreshEvenIfTokenRemains() throws Exception {
        Account account = signup();
        // 관리자 변경 뒤 토큰 폐기(revokeAll)가 실패해 토큰이 남은 상황
        jdbc.update(
                "INSERT INTO password_changes (user_id, changed_by, changed_at) VALUES (?, ?,"
                        + " now() + interval '1 second')",
                account.id(),
                "ADMIN");

        var response =
                post("/api/v1/auth/token/refresh", Map.of("refreshToken", account.refresh()), null);
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(body(response).path("code").asText()).isEqualTo("REFRESH_TOKEN_INVALID");
    }

    @Test
    void tokenStoredBeforeLoginTimeWasRecordedStillRefreshes() throws Exception {
        Account account = signup();
        // 배포 전 형식("회원 id")으로 저장된 토큰
        redis.opsForValue()
                .set(key(account.refresh()), Long.toString(account.id()), properties.refreshTtl());

        var response =
                post("/api/v1/auth/token/refresh", Map.of("refreshToken", account.refresh()), null);
        assertThat(response.statusCode()).isEqualTo(200);
        remember(body(response).path("refreshToken").asText());
    }

    @Test
    void concurrentRefreshSucceedsExactlyOnce() throws Exception {
        Account account = signup();
        HttpRequest request =
                request(
                        "/api/v1/auth/token/refresh",
                        Map.of("refreshToken", account.refresh()),
                        null);
        var first = http.sendAsync(request, HttpResponse.BodyHandlers.ofString());
        var second = http.sendAsync(request, HttpResponse.BodyHandlers.ofString());
        CompletableFuture.allOf(first, second).get(15, TimeUnit.SECONDS);
        List<Integer> statuses = new ArrayList<>();
        for (var future : List.of(first, second)) {
            var response = future.get();
            statuses.add(response.statusCode());
            if (response.statusCode() == 200) {
                remember(body(response).path("refreshToken").asText());
            } else {
                assertThat(body(response).path("code").asText()).isEqualTo("REFRESH_TOKEN_INVALID");
            }
        }
        assertThat(statuses).containsExactlyInAnyOrder(200, 401);
    }

    @Test
    void logoutRevokesTokenAndIsRepeatable() throws Exception {
        Account account = signup();
        var response =
                post(
                        "/api/v1/auth/logout",
                        Map.of("refreshToken", account.refresh()),
                        account.access());
        assertThat(response.statusCode()).isEqualTo(204);
        assertThat(redis.hasKey(key(account.refresh()))).isFalse();
        assertThat(
                        post(
                                        "/api/v1/auth/logout",
                                        Map.of("refreshToken", account.refresh()),
                                        account.access())
                                .statusCode())
                .isEqualTo(204);
        var refresh =
                post("/api/v1/auth/token/refresh", Map.of("refreshToken", account.refresh()), null);
        assertThat(refresh.statusCode()).isEqualTo(401);
        assertThat(body(refresh).path("code").asText()).isEqualTo("REFRESH_TOKEN_INVALID");
    }

    @Test
    void anotherUserCannotRevokeToken() throws Exception {
        Account owner = signup();
        Account other = signup();
        assertThat(
                        post(
                                        "/api/v1/auth/logout",
                                        Map.of("refreshToken", owner.refresh()),
                                        other.access())
                                .statusCode())
                .isEqualTo(204);
        assertThat(redis.hasKey(key(owner.refresh()))).isTrue();
        var refresh =
                post("/api/v1/auth/token/refresh", Map.of("refreshToken", owner.refresh()), null);
        assertThat(refresh.statusCode()).isEqualTo(200);
        remember(body(refresh).path("refreshToken").asText());
    }

    @Test
    void expiredTokenCannotRefresh() throws Exception {
        Account account = signup();
        redis.expire(key(account.refresh()), Duration.ZERO);
        var response =
                post("/api/v1/auth/token/refresh", Map.of("refreshToken", account.refresh()), null);
        assertThat(response.statusCode()).isEqualTo(401);
        assertThat(body(response).path("code").asText()).isEqualTo("REFRESH_TOKEN_INVALID");
    }

    @Test
    void devicesKeepIndependentSessionsAcrossLoginRefreshAndLogout() throws Exception {
        Account first = signup();
        var secondLogin =
                post(
                        "/api/v1/auth/login",
                        Map.of("email", first.email(), "password", "testPass1234"),
                        null);
        assertThat(secondLogin.statusCode()).isEqualTo(200);
        String secondToken = remember(body(secondLogin).path("refreshToken").asText());
        assertThat(secondToken.equals(first.refresh())).isFalse();
        assertThat(redis.hasKey(key(first.refresh()))).isTrue();
        assertThat(redis.hasKey(key(secondToken))).isTrue();

        var rotated =
                post("/api/v1/auth/token/refresh", Map.of("refreshToken", first.refresh()), null);
        assertThat(rotated.statusCode()).isEqualTo(200);
        String nextFirst = remember(body(rotated).path("refreshToken").asText());
        String nextAccess = body(rotated).path("accessToken").asText();
        assertThat(redis.hasKey(key(first.refresh()))).isFalse();
        assertThat(redis.hasKey(key(secondToken))).isTrue();

        assertThat(
                        post("/api/v1/auth/logout", Map.of("refreshToken", nextFirst), nextAccess)
                                .statusCode())
                .isEqualTo(204);
        assertThat(redis.hasKey(key(nextFirst))).isFalse();
        assertThat(redis.hasKey(key(secondToken))).isTrue();
        var otherRefresh =
                post("/api/v1/auth/token/refresh", Map.of("refreshToken", secondToken), null);
        assertThat(otherRefresh.statusCode()).isEqualTo(200);
        remember(body(otherRefresh).path("refreshToken").asText());
    }

    @Test
    void withdrawalRevokesEveryDeviceAndBlocksAccess() throws Exception {
        Account account = signup();
        var secondLogin =
                post(
                        "/api/v1/auth/login",
                        Map.of("email", account.email(), "password", "testPass1234"),
                        null);
        String secondToken = remember(body(secondLogin).path("refreshToken").asText());
        assertThat(redis.opsForZSet().range(userKey(account.id()), 0, -1))
                .contains(key(account.refresh()), key(secondToken));

        var withdrawal =
                post("/api/v1/users/me", Map.of("password", "testPass1234"), account.access());
        assertThat(withdrawal.statusCode()).isEqualTo(204);
        assertThat(redis.hasKey(key(account.refresh()))).isFalse();
        assertThat(redis.hasKey(key(secondToken))).isFalse();
        assertThat(redis.hasKey(userKey(account.id()))).isFalse();

        var refresh = post("/api/v1/auth/token/refresh", Map.of("refreshToken", secondToken), null);
        assertThat(refresh.statusCode()).isEqualTo(401);
        assertThat(body(refresh).path("code").asText()).isEqualTo("REFRESH_TOKEN_INVALID");
        var login =
                post(
                        "/api/v1/auth/login",
                        Map.of("email", account.email(), "password", "testPass1234"),
                        null);
        assertThat(login.statusCode()).isEqualTo(401);
        assertThat(body(login).path("code").asText()).isEqualTo("LOGIN_FAILED");
        var me = get("/api/v1/users/me", account.access());
        assertThat(me.statusCode()).isEqualTo(401);
        assertThat(body(me).path("code").asText()).isEqualTo("UNAUTHORIZED");

        Account again = signup(account.email());
        assertThat(again.id()).isNotEqualTo(account.id());
    }

    @Test
    void withdrawalWithWrongPasswordKeepsAccount() throws Exception {
        Account account = signup();
        var withdrawal =
                post("/api/v1/users/me", Map.of("password", "wrongPass123"), account.access());
        assertThat(withdrawal.statusCode()).isEqualTo(400);
        assertThat(body(withdrawal).path("code").asText()).isEqualTo("PASSWORD_MISMATCH");
        assertThat(redis.hasKey(key(account.refresh()))).isTrue();
        assertThat(get("/api/v1/users/me", account.access()).statusCode()).isEqualTo(200);
    }

    @Test
    void logoutAndRefreshRemoveTokenFromUserIndex() throws Exception {
        Account account = signup();
        var rotated =
                post("/api/v1/auth/token/refresh", Map.of("refreshToken", account.refresh()), null);
        String next = remember(body(rotated).path("refreshToken").asText());
        String access = body(rotated).path("accessToken").asText();
        assertThat(redis.opsForZSet().range(userKey(account.id()), 0, -1))
                .containsExactly(key(next));

        post("/api/v1/auth/logout", Map.of("refreshToken", next), access);
        assertThat(redis.opsForZSet().range(userKey(account.id()), 0, -1)).isEmpty();
    }

    @Test
    void issuingPrunesExpiredKeysFromUserIndex() throws Exception {
        Account account = signup();
        String stale = "refresh:stale-" + UUID.randomUUID();
        redis.opsForZSet().add(userKey(account.id()), stale, 1);

        var login =
                post(
                        "/api/v1/auth/login",
                        Map.of("email", account.email(), "password", "testPass1234"),
                        null);
        String token = remember(body(login).path("refreshToken").asText());

        assertThat(redis.opsForZSet().range(userKey(account.id()), 0, -1))
                .containsExactlyInAnyOrder(key(account.refresh()), key(token));
        Double expiresAt = redis.opsForZSet().score(userKey(account.id()), key(token));
        assertThat(expiresAt)
                .isCloseTo(
                        (double)
                                (Instant.now().getEpochSecond()
                                        + properties.refreshTtl().toSeconds()),
                        offset(60.0));
    }

    @Test
    void passwordChangeKeepsThisDeviceWithNewTokensAndLogsOutOthers() throws Exception {
        Account account = signup();
        var otherDevice =
                post(
                        "/api/v1/auth/login",
                        Map.of("email", account.email(), "password", "testPass1234"),
                        null);
        String other = remember(body(otherDevice).path("refreshToken").asText());

        var changed =
                http.send(
                        HttpRequest.newBuilder(uri("/api/v1/users/me/password"))
                                .timeout(Duration.ofSeconds(10))
                                .header("Content-Type", "application/json")
                                .header("Authorization", "Bearer " + account.access())
                                .method(
                                        "PATCH",
                                        HttpRequest.BodyPublishers.ofString(
                                                json.writeValueAsString(
                                                        Map.of(
                                                                "currentPassword",
                                                                "testPass1234",
                                                                "newPassword",
                                                                "newPass5678"))))
                                .build(),
                        HttpResponse.BodyHandlers.ofString());
        assertThat(changed.statusCode()).isEqualTo(200);
        String next = remember(body(changed).path("refreshToken").asText());
        assertThat(get("/api/v1/users/me", body(changed).path("accessToken").asText()).statusCode())
                .isEqualTo(200);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT changed_by FROM password_changes WHERE user_id = ?",
                                String.class,
                                account.id()))
                .isEqualTo("USER");

        // 바꾸기 전 토큰은 이 기기 것도, 다른 기기 것도 쓸 수 없다
        for (String old : List.of(account.refresh(), other)) {
            var rejected = post("/api/v1/auth/token/refresh", Map.of("refreshToken", old), null);
            assertThat(rejected.statusCode()).isEqualTo(401);
        }
        // 응답으로 받은 새 토큰은 재발급된다
        var refreshed = post("/api/v1/auth/token/refresh", Map.of("refreshToken", next), null);
        assertThat(refreshed.statusCode()).isEqualTo(200);
        remember(body(refreshed).path("refreshToken").asText());
    }

    @Test
    void fiveWrongPasswordsLockLoginEvenWithRightPasswordUntilKeyExpires() throws Exception {
        Account account = signup();
        for (int i = 0; i < 5; i++) {
            var wrong =
                    post(
                            "/api/v1/auth/login",
                            Map.of("email", account.email(), "password", "wrongPass1234"),
                            null);
            assertThat(wrong.statusCode()).isEqualTo(401);
            assertThat(body(wrong).path("code").asText()).isEqualTo("LOGIN_FAILED");
        }

        var locked =
                post(
                        "/api/v1/auth/login",
                        Map.of(
                                "email",
                                account.email().toUpperCase(Locale.ROOT),
                                "password",
                                "testPass1234"),
                        null);
        assertThat(locked.statusCode()).isEqualTo(429);
        assertThat(body(locked).path("code").asText()).isEqualTo("LOGIN_LOCKED");
        long retryAfter = Long.parseLong(locked.headers().firstValue("Retry-After").orElseThrow());
        assertThat(retryAfter).isBetween(890L, 900L);
        assertThat(body(locked).path("retryAfterSeconds").asLong()).isEqualTo(retryAfter);
        // 잠긴 동안의 시도는 세지 않는다
        assertThat(redis.opsForValue().get(loginFailKey(account.email()))).isEqualTo("5");

        // 15분이 지난 것처럼 키를 지우면 다시 로그인한다
        redis.delete(loginFailKey(account.email()));
        var login =
                post(
                        "/api/v1/auth/login",
                        Map.of("email", account.email(), "password", "testPass1234"),
                        null);
        assertThat(login.statusCode()).isEqualTo(200);
        remember(body(login).path("refreshToken").asText());
    }

    @Test
    void successfulLoginResetsFailures() throws Exception {
        Account account = signup();
        for (int i = 0; i < 4; i++) {
            post(
                    "/api/v1/auth/login",
                    Map.of("email", account.email(), "password", "wrongPass1234"),
                    null);
        }
        var login =
                post(
                        "/api/v1/auth/login",
                        Map.of("email", account.email(), "password", "testPass1234"),
                        null);
        assertThat(login.statusCode()).isEqualTo(200);
        remember(body(login).path("refreshToken").asText());
        assertThat(redis.hasKey(loginFailKey(account.email()))).isFalse();
    }

    @Test
    void unknownEmailIsLockedTheSameWay() throws Exception {
        String email = "redis-it-unknown-" + UUID.randomUUID() + "@example.com";
        emails.add(email);
        for (int i = 0; i < 5; i++) {
            post("/api/v1/auth/login", Map.of("email", email, "password", "wrongPass1234"), null);
        }
        var locked =
                post(
                        "/api/v1/auth/login",
                        Map.of("email", email, "password", "wrongPass1234"),
                        null);
        assertThat(locked.statusCode()).isEqualTo(429);
        assertThat(body(locked).path("code").asText()).isEqualTo("LOGIN_LOCKED");
    }

    private Account signup() throws Exception {
        return signup("redis-it-" + UUID.randomUUID() + "@example.com");
    }

    private Account signup(String email) throws Exception {
        emails.add(email);
        List<Map<String, String>> agreements =
                List.of("TERMS", "PRIVACY", "RECORDING").stream()
                        .map(type -> Map.of("termsType", type, "termsVersion", "1.0"))
                        .toList();
        var response =
                post(
                        "/api/v1/auth/signup",
                        Map.of(
                                "email",
                                email,
                                "password",
                                "testPass1234",
                                "nickname",
                                "Redis 검증",
                                "agreements",
                                agreements),
                        null);
        assertThat(response.statusCode()).isEqualTo(201);
        JsonNode body = body(response);
        long id = body.path("user").path("id").asLong();
        tokenKeys.add(userKey(id));
        return new Account(
                email,
                id,
                body.path("accessToken").asText(),
                remember(body.path("refreshToken").asText()));
    }

    private String remember(String token) throws Exception {
        tokenKeys.add(key(token));
        return token;
    }

    private static String key(String token) throws Exception {
        return "refresh:"
                + HexFormat.of()
                        .formatHex(
                                MessageDigest.getInstance("SHA-256")
                                        .digest(token.getBytes(StandardCharsets.UTF_8)));
    }

    private static String loginFailKey(String email) {
        return "login-fail:" + Hashes.sha256Hex(User.normalizeEmail(email));
    }

    private static String userKey(long userId) {
        return "refresh-user:" + userId;
    }

    private URI uri(String endpoint) {
        return URI.create("http://127.0.0.1:" + port + endpoint);
    }

    private HttpRequest request(String endpoint, Object payload, String accessToken) {
        var builder =
                HttpRequest.newBuilder(uri(endpoint))
                        .timeout(Duration.ofSeconds(10))
                        .header("Content-Type", "application/json")
                        .POST(
                                HttpRequest.BodyPublishers.ofString(
                                        json.writeValueAsString(payload)));
        if (accessToken != null) {
            builder.header("Authorization", "Bearer " + accessToken);
        }
        return builder.build();
    }

    private HttpResponse<String> post(String endpoint, Object payload, String accessToken)
            throws Exception {
        return http.send(
                request(endpoint, payload, accessToken), HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> get(String endpoint, String accessToken) throws Exception {
        return http.send(
                HttpRequest.newBuilder(uri(endpoint))
                        .timeout(Duration.ofSeconds(10))
                        .header("Authorization", "Bearer " + accessToken)
                        .GET()
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private JsonNode body(HttpResponse<String> response) {
        return json.readTree(response.body());
    }

    private record Account(String email, long id, String access, String refresh) {}
}
