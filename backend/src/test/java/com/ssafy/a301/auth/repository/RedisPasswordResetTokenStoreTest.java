package com.ssafy.a301.auth.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.auth.reset.PasswordResetProperties;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class RedisPasswordResetTokenStoreTest {
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> values = mock(ValueOperations.class);

    private final RedisPasswordResetTokenStore store =
            new RedisPasswordResetTokenStore(
                    redis,
                    new PasswordResetProperties(
                            Duration.ofMinutes(30),
                            Duration.ofMinutes(1),
                            "http://localhost:3000/password-reset",
                            ""));

    @BeforeEach
    void setUp() {
        when(redis.opsForValue()).thenReturn(values);
    }

    @Test
    void tokenIsKeptUnderHashedKeyAndUsedOnce() {
        Instant before = Instant.now();

        String token = store.issue(7L);

        ArgumentCaptor<String> key = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> value = ArgumentCaptor.forClass(String.class);
        verify(values).set(key.capture(), value.capture(), eq(Duration.ofMinutes(30)));
        assertThat(key.getValue()).startsWith("password-reset:").doesNotContain(token);
        assertThat(value.getValue()).startsWith("7:");

        when(values.getAndDelete(key.getValue())).thenReturn(value.getValue());
        var reset = store.consume(token);
        assertThat(reset.userId()).isEqualTo(7L);
        assertThat(reset.issuedAt()).isBetween(before.minusMillis(1), Instant.now());
        when(values.getAndDelete(anyString())).thenReturn(null);
        assertThat(store.consume(token)).isNull();
    }

    @Test
    void resendIntervalIsSetOnlyIfAbsentUnderHashedEmail() {
        when(values.setIfAbsent(anyString(), eq("1"), eq(Duration.ofMinutes(1))))
                .thenReturn(true)
                .thenReturn(false);

        assertThat(store.tryStartResendInterval("a@test.com")).isTrue();
        assertThat(store.tryStartResendInterval("a@test.com")).isFalse();

        ArgumentCaptor<String> key = ArgumentCaptor.forClass(String.class);
        verify(values, times(2)).setIfAbsent(key.capture(), eq("1"), eq(Duration.ofMinutes(1)));
        assertThat(key.getValue()).startsWith("password-reset-wait:").doesNotContain("a@test.com");
    }
}
