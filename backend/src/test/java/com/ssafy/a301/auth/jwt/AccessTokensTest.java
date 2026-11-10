package com.ssafy.a301.auth.jwt;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.ssafy.a301.auth.config.SecurityConfig;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.JwtException;

class AccessTokensTest {
    private final SecurityConfig security = new SecurityConfig();
    private final AuthProperties properties =
            new AuthProperties(
                    "test-secret-at-least-thirty-two-bytes",
                    Duration.ofHours(1),
                    Duration.ofDays(30));
    private final UserRepository users = mock(UserRepository.class);

    @Test
    void issuedTokenIsVerifiedAndIdentifiesActiveUser() {
        when(users.findByIdAndDeletedAtIsNull(7L))
                .thenReturn(Optional.of(new User("a@test.com", "hash", "회원")));
        String token =
                new AccessTokens(security.jwtEncoder(properties), properties).issue(7L, "회원");
        assertThat(security.jwtDecoder(properties, users).decode(token).getSubject())
                .isEqualTo("7");
        assertThat(
                        security.jwtDecoder(properties, users)
                                .decode(token)
                                .getClaimAsString("nickname"))
                .isEqualTo("회원");
    }

    @Test
    void withdrawnUserTokenIsRejected() {
        when(users.findByIdAndDeletedAtIsNull(7L)).thenReturn(Optional.empty());
        String token =
                new AccessTokens(security.jwtEncoder(properties), properties).issue(7L, "회원");
        var decoder = security.jwtDecoder(properties, users);
        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
    }

    @Test
    void tokenSignedWithAnotherSecretIsRejected() {
        var other =
                new AuthProperties(
                        "another-secret-at-least-thirty-two-bytes",
                        Duration.ofHours(1),
                        Duration.ofDays(30));
        String token = new AccessTokens(security.jwtEncoder(other), other).issue(7L, "회원");
        var decoder = security.jwtDecoder(properties, users);
        assertThatThrownBy(() -> decoder.decode(token)).isInstanceOf(JwtException.class);
    }
}
