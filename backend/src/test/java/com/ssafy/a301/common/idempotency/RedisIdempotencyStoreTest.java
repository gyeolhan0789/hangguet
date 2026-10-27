package com.ssafy.a301.common.idempotency;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;
import tools.jackson.databind.json.JsonMapper;

class RedisIdempotencyStoreTest {
    private static final UUID KEY = UUID.fromString("6f1c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34");
    private static final String REDIS_KEY = "idem:7:" + KEY;
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> values = mock(ValueOperations.class);

    private final RedisIdempotencyStore store = new RedisIdempotencyStore(redis);

    @BeforeEach
    void setUp() {
        when(redis.opsForValue()).thenReturn(values);
    }

    @Test
    void beginMarksProcessingForOneMinute() {
        String processing = json(IdempotencyRecord.processing("fp"));
        when(values.setIfAbsent(REDIS_KEY, processing, Duration.ofMinutes(1))).thenReturn(true);

        assertThat(store.begin(7L, KEY, "fp")).isNull();
    }

    @Test
    void beginReturnsExistingRecord() {
        IdempotencyRecord done = IdempotencyRecord.completed("fp", 201, "application/json", "{}");
        when(values.setIfAbsent(eq(REDIS_KEY), any(), any(Duration.class))).thenReturn(false);
        when(values.get(REDIS_KEY)).thenReturn(json(done));

        assertThat(store.begin(7L, KEY, "fp")).isEqualTo(done);
    }

    @Test
    @SuppressWarnings("unchecked")
    void completeKeepsResponseFor24HoursOnlyOverOwnProcessingMark() {
        IdempotencyRecord done = IdempotencyRecord.completed("fp", 202, null, "");

        store.complete(7L, KEY, done);

        verify(redis)
                .execute(
                        any(RedisScript.class),
                        eq(List.of(REDIS_KEY)),
                        eq(json(IdempotencyRecord.processing("fp"))),
                        eq(json(done)),
                        eq(Long.toString(Duration.ofHours(24).toMillis())));
    }

    @Test
    @SuppressWarnings("unchecked")
    void releaseDeletesOnlyOwnProcessingMark() {
        store.release(7L, KEY, "fp");

        verify(redis)
                .execute(
                        any(RedisScript.class),
                        eq(List.of(REDIS_KEY)),
                        eq(json(IdempotencyRecord.processing("fp"))));
    }

    private static String json(IdempotencyRecord record) {
        return JSON.writeValueAsString(record);
    }
}
