package com.ssafy.a301.admin.config;

import com.ssafy.a301.admin.jwt.AdminTokens;
import com.ssafy.a301.admin.repository.AdminRepository;
import com.ssafy.a301.admin.repository.AdminTokenStore;
import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FilterExceptionFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;
import tools.jackson.databind.json.JsonMapper;

/**
 * 관리 API(/api/v1/admin/**)의 인증. 회원 인증(auth.config.SecurityConfig)을 바꾸지 않도록 이 경로만 맡는 필터 체인을 먼저 둔다.
 * 토큰은 발급자 a301-admin, 삭제하지 않은 관리자, 로그아웃하지 않은 토큰만 받는다. 디코더는 회원용 JwtDecoder 빈과 섞이지 않도록 빈으로 두지 않는다.
 */
@Configuration
@EnableConfigurationProperties(AdminProperties.class)
public class AdminSecurityConfig {

    @Bean
    @Order(1)
    public SecurityFilterChain adminSecurityFilterChain(
            HttpSecurity http,
            AuthProperties properties,
            AdminRepository admins,
            AdminTokenStore revokedTokens)
            throws Exception {
        NimbusJwtDecoder decoder = decoder(properties, admins, revokedTokens);
        http.securityMatcher("/api/v1/admin/**")
                .addFilterBefore(new FilterExceptionFilter(), BearerTokenAuthenticationFilter.class)
                .csrf(csrf -> csrf.disable())
                .sessionManagement(
                        session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(
                        auth ->
                                auth.requestMatchers(HttpMethod.POST, "/api/v1/admin/auth/login")
                                        .permitAll()
                                        .anyRequest()
                                        .authenticated())
                .exceptionHandling(
                        errors ->
                                errors.authenticationEntryPoint(
                                        (request, response, ex) ->
                                                writeProblem(
                                                        request, response, ErrorCode.UNAUTHORIZED)))
                .oauth2ResourceServer(
                        resource ->
                                resource.jwt(jwt -> jwt.decoder(decoder))
                                        .authenticationEntryPoint(
                                                (request, response, ex) ->
                                                        writeProblem(
                                                                request,
                                                                response,
                                                                isExpired(ex)
                                                                        ? ErrorCode.TOKEN_EXPIRED
                                                                        : ErrorCode.UNAUTHORIZED)));
        return http.build();
    }

    private static NimbusJwtDecoder decoder(
            AuthProperties properties, AdminRepository admins, AdminTokenStore revokedTokens) {
        var decoder =
                NimbusJwtDecoder.withSecretKey(
                                new SecretKeySpec(
                                        properties.jwtSecret().getBytes(StandardCharsets.UTF_8),
                                        "HmacSHA256"))
                        .macAlgorithm(MacAlgorithm.HS256)
                        .build();
        OAuth2TokenValidator<Jwt> activeAdmin =
                jwt -> {
                    try {
                        long id = Long.parseLong(jwt.getSubject());
                        if (jwt.getExpiresAt() != null
                                && admins.findByIdAndDeletedAtIsNull(id).isPresent()
                                && !revokedTokens.isRevoked(jwt.getTokenValue())) {
                            return OAuth2TokenValidatorResult.success();
                        }
                    } catch (NumberFormatException ex) {
                        return invalid("invalid_token");
                    }
                    return invalid("invalid_token");
                };
        OAuth2TokenValidator<Jwt> expiry =
                jwt ->
                        jwt.getExpiresAt() != null && !jwt.getExpiresAt().isAfter(Instant.now())
                                ? invalid("TOKEN_EXPIRED")
                                : OAuth2TokenValidatorResult.success();
        decoder.setJwtValidator(
                new DelegatingOAuth2TokenValidator<>(
                        JwtValidators.createDefaultWithIssuer(AdminTokens.ISSUER),
                        activeAdmin,
                        expiry));
        return decoder;
    }

    private static boolean isExpired(Throwable ex) {
        for (Throwable cause = ex; cause != null; cause = cause.getCause()) {
            if (cause instanceof JwtValidationException validation
                    && validation.getErrors().stream()
                            .anyMatch(e -> "TOKEN_EXPIRED".equals(e.getErrorCode()))) {
                return true;
            }
        }
        return false;
    }

    private static OAuth2TokenValidatorResult invalid(String code) {
        return OAuth2TokenValidatorResult.failure(new OAuth2Error(code));
    }

    private static void writeProblem(
            HttpServletRequest request, HttpServletResponse response, ErrorCode code)
            throws IOException {
        response.setStatus(code.status().value());
        response.setCharacterEncoding("UTF-8");
        response.setContentType("application/problem+json");
        response.getWriter()
                .write(
                        JsonMapper.builder()
                                .build()
                                .writeValueAsString(
                                        Map.of(
                                                "title",
                                                "Unauthorized",
                                                "status",
                                                401,
                                                "detail",
                                                code.message(),
                                                "instance",
                                                request.getRequestURI(),
                                                "code",
                                                code.name())));
    }
}
