package com.ssafy.a301.common.idempotency;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/** 실행 중인 Redis에서 처리 중 표시·응답 저장·표시 해제가 동작하는지 확인한다. 만든 키만 지운다. */
@Tag("redis-integration")
class RedisIdempotencyStoreIntegrationTest {
    private static final long USER_ID = Long.MAX_VALUE;

    private final UUID key = UUID.randomUUID();
    private LettuceConnectionFactory connection;
    private StringRedisTemplate redis;
    private RedisIdempotencyStore store;

    @BeforeEach
    void setUp() {
        connection =
                new LettuceConnectionFactory(
                        System.getenv().getOrDefault("REDIS_HOST", "localhost"),
                        Integer.parseInt(System.getenv().getOrDefault("REDIS_PORT", "6379")));
        connection.afterPropertiesSet();
        connection.start();
        redis = new StringRedisTemplate(connection);
        store = new RedisIdempotencyStore(redis);
    }

    @AfterEach
    void tearDown() {
        redis.delete("idem:" + USER_ID + ":" + key);
        connection.destroy();
    }

    @Test
    void secondBeginSeesProcessingThenCompletedRecord() {
        assertThat(store.begin(USER_ID, key, "fp")).isNull();
        assertThat(store.begin(USER_ID, key, "fp")).isEqualTo(IdempotencyRecord.processing("fp"));
        assertThat(redis.getExpire("idem:" + USER_ID + ":" + key)).isBetween(1L, 60L);

        IdempotencyRecord done = IdempotencyRecord.completed("fp", 201, "application/json", "{}");
        store.complete(USER_ID, key, done);

        assertThat(store.begin(USER_ID, key, "other")).isEqualTo(done);
        assertThat(redis.getExpire("idem:" + USER_ID + ":" + key)).isGreaterThan(60L);
    }

    @Test
    void releaseKeepsCompletedRecord() {
        store.begin(USER_ID, key, "fp");
        store.release(USER_ID, key, "fp");
        assertThat(store.begin(USER_ID, key, "fp")).isNull();

        IdempotencyRecord done = IdempotencyRecord.completed("fp", 202, null, "");
        store.complete(USER_ID, key, done);
        store.release(USER_ID, key, "fp");

        assertThat(store.begin(USER_ID, key, "fp")).isEqualTo(done);
    }

    @Test
    void completeDoesNotOverwriteAnotherRequestsMarker() {
        // 처리 중 표시가 만료된 뒤 다른 요청(다른 본문)이 같은 키를 잡았다
        assertThat(store.begin(USER_ID, key, "other")).isNull();

        store.complete(
                USER_ID, key, IdempotencyRecord.completed("fp", 201, "application/json", "{}"));

        assertThat(store.begin(USER_ID, key, "other"))
                .isEqualTo(IdempotencyRecord.processing("other"));
    }

    @Test
    void completeStoresResponseEvenIfMarkerExpired() {
        IdempotencyRecord done = IdempotencyRecord.completed("fp", 201, "application/json", "{}");

        store.complete(USER_ID, key, done);

        assertThat(store.begin(USER_ID, key, "fp")).isEqualTo(done);
    }
}
