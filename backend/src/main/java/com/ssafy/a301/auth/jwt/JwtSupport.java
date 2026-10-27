package com.ssafy.a301.auth.jwt;

import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.ProblemResponses;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.web.AuthenticationEntryPoint;

/**
 * 회원(auth.config.SecurityConfig)·관리자(admin.config.AdminSecurityConfig) 토큰 검증이 함께 쓰는 서명 키·만료 판정·401
 * 응답
 */
public final class JwtSupport {
    private static final String EXPIRED = "TOKEN_EXPIRED";

    private JwtSupport() {}

    /** HS256 서명 키(auth.jwt-secret). 회원·관리자 토큰이 같은 키를 쓰고 발급자(iss)로 나눈다 */
    public static SecretKeySpec hmacKey(AuthProperties properties) {
        return new SecretKeySpec(
                properties.jwtSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    }

    /** 만료된 토큰을 TOKEN_EXPIRED로 표시해 거절한다. 엔트리 포인트가 이 표시로 401 TOKEN_EXPIRED를 준다 */
    public static OAuth2TokenValidator<Jwt> notExpired() {
        return jwt ->
                jwt.getExpiresAt() != null && !jwt.getExpiresAt().isAfter(Instant.now())
                        ? OAuth2TokenValidatorResult.failure(new OAuth2Error(EXPIRED))
                        : OAuth2TokenValidatorResult.success();
    }

    public static OAuth2TokenValidatorResult invalid() {
        return OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token"));
    }

    /** 토큰 검증 실패 응답. 만료면 401 TOKEN_EXPIRED, 그 밖은 401 UNAUTHORIZED */
    public static AuthenticationEntryPoint tokenEntryPoint() {
        return (request, response, ex) ->
                ProblemResponses.write(
                        request,
                        response,
                        isExpired(ex) ? ErrorCode.TOKEN_EXPIRED : ErrorCode.UNAUTHORIZED);
    }

    /** 토큰 없이 인증이 필요한 경로를 부르면 401 UNAUTHORIZED */
    public static AuthenticationEntryPoint unauthorizedEntryPoint() {
        return (request, response, ex) ->
                ProblemResponses.write(request, response, ErrorCode.UNAUTHORIZED);
    }

    private static boolean isExpired(Throwable ex) {
        for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
            if (cause instanceof JwtValidationException validation
                    && validation.getErrors().stream()
                            .anyMatch(e -> EXPIRED.equals(e.getErrorCode()))) {
                return true;
            }
        }
        return false;
    }
}
