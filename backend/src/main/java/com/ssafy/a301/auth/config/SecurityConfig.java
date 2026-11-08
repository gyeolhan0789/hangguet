package com.ssafy.a301.auth.config;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.auth.jwt.JwtSupport;
import com.ssafy.a301.common.error.FilterExceptionFilter;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
@EnableConfigurationProperties(AuthProperties.class)
public class SecurityConfig {
    @Bean
    public PasswordEncoder passwordEncoder() {
        return Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8();
    }

    @Bean
    public JwtEncoder jwtEncoder(AuthProperties properties) {
        return new NimbusJwtEncoder(new ImmutableSecret<>(JwtSupport.hmacKey(properties)));
    }

    @Bean
    public NimbusJwtDecoder jwtDecoder(AuthProperties properties, UserRepository users) {
        var decoder =
                NimbusJwtDecoder.withSecretKey(JwtSupport.hmacKey(properties))
                        .macAlgorithm(MacAlgorithm.HS256)
                        .build();
        // 탈퇴하지 않은 회원의 토큰이고, 비밀번호를 바꾼 뒤에 발급한 토큰이어야 한다
        OAuth2TokenValidator<Jwt> activeUser =
                jwt -> {
                    try {
                        long id = Long.parseLong(jwt.getSubject());
                        if (jwt.getExpiresAt() != null
                                && jwt.getIssuedAt() != null
                                && users.findByIdAndDeletedAtIsNull(id)
                                        .filter(user -> issuedAfterPasswordChange(jwt, user))
                                        .isPresent()) {
                            return OAuth2TokenValidatorResult.success();
                        }
                    } catch (NumberFormatException ex) {
                        return JwtSupport.invalid();
                    }
                    return JwtSupport.invalid();
                };
        decoder.setJwtValidator(
                new DelegatingOAuth2TokenValidator<>(
                        JwtValidators.createDefaultWithIssuer("a301"),
                        activeUser,
                        JwtSupport.notExpired()));
        return decoder;
    }

    /**
     * 토큰 발급 시각(iat)은 초 단위로 내려 담기므로 변경 시각도 초 단위로 내려 비교한다. 그래서 바꾼 뒤 바로 받은 새 토큰(2.3 응답)은 막히지 않고, 같은 초
     * 안에 바꾸기 직전 발급한 토큰만 남을 수 있다
     */
    private static boolean issuedAfterPasswordChange(Jwt jwt, User user) {
        OffsetDateTime changedAt = user.getPasswordChangedAt();
        return changedAt == null
                || !jwt.getIssuedAt()
                        .isBefore(changedAt.toInstant().truncatedTo(ChronoUnit.SECONDS));
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http.addFilterBefore(new FilterExceptionFilter(), BearerTokenAuthenticationFilter.class)
                .csrf(csrf -> csrf.disable())
                .sessionManagement(
                        session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(
                        auth ->
                                auth.requestMatchers(
                                                "/actuator/health",
                                                "/actuator/prometheus",
                                                "/docs",
                                                "/docs/**",
                                                "/swagger-ui/**",
                                                "/v3/api-docs/**",
                                                "/error")
                                        .permitAll()
                                        .requestMatchers(
                                                HttpMethod.GET, "/api/v1/auth/email-availability")
                                        .permitAll()
                                        .requestMatchers(
                                                HttpMethod.POST,
                                                "/api/v1/auth/signup",
                                                "/api/v1/auth/login",
                                                "/api/v1/auth/token/refresh",
                                                "/api/v1/auth/oauth/*")
                                        .permitAll()
                                        // 9. 문의: 비회원도 작성 · 조회 · 이어서 쓰기 · 종료 · 사진 올리기를 한다(토큰을 보내면 회원
                                        // 문의). 9.2 목록은 회원만
                                        .requestMatchers(
                                                HttpMethod.POST,
                                                "/api/v1/inquiries",
                                                "/api/v1/inquiries/attachments/upload-url")
                                        .permitAll()
                                        .requestMatchers(HttpMethod.GET, "/api/v1/inquiries/*")
                                        .permitAll()
                                        .requestMatchers(
                                                HttpMethod.POST,
                                                "/api/v1/inquiries/*/messages",
                                                "/api/v1/inquiries/*/close")
                                        .permitAll()
                                        .anyRequest()
                                        .authenticated())
                .exceptionHandling(
                        errors ->
                                errors.authenticationEntryPoint(
                                        JwtSupport.unauthorizedEntryPoint()))
                .oauth2ResourceServer(
                        resource ->
                                resource.jwt(jwt -> {})
                                        .authenticationEntryPoint(JwtSupport.tokenEntryPoint()));
        return http.build();
    }
}
