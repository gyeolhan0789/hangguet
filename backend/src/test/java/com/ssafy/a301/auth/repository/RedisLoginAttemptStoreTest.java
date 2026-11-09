package com.ssafy.a301.auth.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

class RedisLoginAttemptStoreTest {
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);
    private final RedisLoginAttemptStore store = new RedisLoginAttemptStore(redis);

    @Test
    @SuppressWarnings("unchecked")
    void countsUnderHashedEmailKeyWithLimitAndLockTime() {
        when(redis.execute(any(RedisScript.class), anyList(), any(), any())).thenReturn(0L);

        assertThat(store.tryAcquire("a@test.com")).isZero();

        ArgumentCaptor<List<String>> keys = ArgumentCaptor.forClass(List.class);
        verify(redis).execute(any(RedisScript.class), keys.capture(), eq("5"), eq("900000"));
        assertThat(keys.getValue()).singleElement().asString().startsWith("login-fail:");
        assertThat(keys.getValue().get(0)).doesNotContain("a@test.com");

        store.reset("a@test.com");
        verify(redis).delete(keys.getValue().get(0));
    }

    @Test
    @SuppressWarnings("unchecked")
    void lockedEmailGetsRemainingTime() {
        when(redis.execute(any(RedisScript.class), anyList(), any(), any())).thenReturn(61_000L);

        assertThat(store.tryAcquire("a@test.com")).isEqualTo(Duration.ofSeconds(61));
    }
}
