package com.ssafy.a301.auth.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.auth.config.SecurityConfig;
import com.ssafy.a301.auth.dto.SocialLoginResponse;
import com.ssafy.a301.auth.dto.TokenResponse;
import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.auth.service.AuthService;
import com.ssafy.a301.auth.service.SocialAuthService;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@WebMvcTest(AuthController.class)
@Import(SecurityConfig.class)
@TestPropertySource(
        properties = {
            "auth.jwt-secret=test-secret-at-least-thirty-two-bytes",
            "auth.access-ttl=1h",
            "auth.refresh-ttl=30d"
        })
class AuthControllerTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private AuthService service;
    @MockitoBean private SocialAuthService social;
    @MockitoBean private UserRepository users;
    @Autowired private JwtEncoder encoder;
    @Autowired private AuthProperties properties;

    @Test
    void availabilityIsPublic() throws Exception {
        when(service.isEmailAvailable("a@test.com")).thenReturn(true);
        mvc.perform(get("/api/v1/auth/email-availability").param("email", "a@test.com"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(true));
    }

    @Test
    void emptyEmailIsValidationError() throws Exception {
        mvc.perform(get("/api/v1/auth/email-availability").param("email", ""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void invalidSignupIsRejected() throws Exception {
        mvc.perform(
                        post("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void lockedLoginIsTooManyRequestsWithRetryAfter() throws Exception {
        // 남은 시간은 초 단위로 올린다
        when(service.login(any()))
                .thenThrow(new ApiException(ErrorCode.LOGIN_LOCKED, Duration.ofMillis(60_500)));
        mvc.perform(
                        post("/api/v1/auth/login")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"email\":\"a@test.com\",\"password\":\"abcd1234\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string("Retry-After", "61"))
                .andExpect(jsonPath("$.code").value("LOGIN_LOCKED"))
                .andExpect(jsonPath("$.retryAfterSeconds").value(61));
    }

    @Test
    void socialLoginAndSignupArePublic() throws Exception {
        var tokens = new TokenResponse("access", "refresh", 3600, null);
        when(social.login("kakao", "code", "https://a301/callback"))
                .thenReturn(SocialLoginResponse.loggedIn(tokens));
        mvc.perform(
                        post("/api/v1/auth/oauth/kakao")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"code\":\"code\",\"redirectUri\":\"https://a301/callback\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.signupRequired").value(false))
                .andExpect(jsonPath("$.token.accessToken").value("access"));

        when(social.signup(any())).thenReturn(tokens);
        mvc.perform(
                        post("/api/v1/auth/oauth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"signupToken\":\"t\",\"agreements\":["
                                            + "{\"termsType\":\"TERMS\",\"termsVersion\":\"1.0\"},"
                                            + "{\"termsType\":\"PRIVACY\",\"termsVersion\":\"1.0\"},"
                                            + "{\"termsType\":\"RECORDING\",\"termsVersion\":\"1.0\"}]}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.refreshToken").value("refresh"));
    }

    @Test
    void socialLoginWithoutCodeIsValidationError() throws Exception {
        mvc.perform(
                        post("/api/v1/auth/oauth/kakao")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"redirectUri\":\"https://a301/callback\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("code"));
        verify(social, never()).login(anyString(), anyString(), anyString());
    }

    @Test
    void logoutRequiresAuthentication() throws Exception {
        mvc.perform(
                        post("/api/v1/auth/logout")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"refreshToken\":\"token\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void expiredAccessTokenIsTokenExpired() throws Exception {
        when(users.findByIdAndDeletedAtIsNull(7L))
                .thenReturn(Optional.of(new User("a@test.com", "hash", "회원")));
        Instant issuedAt = Instant.now().minus(Duration.ofHours(2));
        String expired =
                encoder.encode(
                                JwtEncoderParameters.from(
                                        JwsHeader.with(MacAlgorithm.HS256).build(),
                                        JwtClaimsSet.builder()
                                                .issuer("a301")
                                                .subject("7")
                                                .issuedAt(issuedAt)
                                                .expiresAt(issuedAt.plus(Duration.ofHours(1)))
                                                .build()))
                        .getTokenValue();
        mvc.perform(logoutWith(expired))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("TOKEN_EXPIRED"));
    }

    @Test
    void tokenSignedWithAnotherSecretIsUnauthorized() throws Exception {
        var other =
                new AuthProperties(
                        "another-secret-at-least-thirty-two-bytes",
                        Duration.ofHours(1),
                        Duration.ofDays(30));
        String forged =
                new AccessTokens(new SecurityConfig().jwtEncoder(other), other).issue(7L, "회원");
        mvc.perform(logoutWith(forged))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void withdrawnUsersValidTokenIsUnauthorized() throws Exception {
        when(users.findByIdAndDeletedAtIsNull(7L)).thenReturn(Optional.empty());
        String token = new AccessTokens(encoder, properties).issue(7L, "회원");
        mvc.perform(logoutWith(token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void databaseFailureWhileCheckingTokenIsInternalErrorProblem() throws Exception {
        when(users.findByIdAndDeletedAtIsNull(7L))
                .thenThrow(new DataAccessResourceFailureException("DB 연결 실패"));
        String token = new AccessTokens(encoder, properties).issue(7L, "회원");
        mvc.perform(logoutWith(token))
                .andExpect(status().isInternalServerError())
                .andExpect(content().contentTypeCompatibleWith("application/problem+json"))
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
                .andExpect(jsonPath("$.detail").value("잠시 후 다시 시도해 주세요."));
        verify(service, never()).logout(anyLong(), anyString());
    }

    @Test
    void activeUsersTokenPassesSecurity() throws Exception {
        when(users.findByIdAndDeletedAtIsNull(7L))
                .thenReturn(Optional.of(new User("a@test.com", "hash", "회원")));
        String token = new AccessTokens(encoder, properties).issue(7L, "회원");
        mvc.perform(logoutWith(token)).andExpect(status().isNoContent());
        verify(service).logout(7L, "token");
    }

    @Test
    void logoutUsesAuthenticatedUser() throws Exception {
        mvc.perform(
                        post("/api/v1/auth/logout")
                                .with(jwt().jwt(token -> token.subject("7")))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"refreshToken\":\"token\"}"))
                .andExpect(status().isNoContent());
        verify(service).logout(7L, "token");
    }

    // 실제 서명한 JWT를 Authorization 헤더로 보내 Security 필터(검증·오류 응답)를 그대로 거친다.
    private static MockHttpServletRequestBuilder logoutWith(String accessToken) {
        return post("/api/v1/auth/logout")
                .header("Authorization", "Bearer " + accessToken)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"refreshToken\":\"token\"}");
    }
}
