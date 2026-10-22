package com.ssafy.a301.common.idempotency;

import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * BE 설계 7·8장의 idem:{userId}:{Idempotency-Key} 키. 값은 IdempotencyRecord JSON이다. 처리 중 표시는 서버가 처리 도중
 * 멈춰도 같은 키로 다시 시도할 수 있게 1분 뒤 사라지고, 끝난 응답은 24시간 보관한다.
 */
@Component
public class RedisIdempotencyStore implements IdempotencyStore {
    static final Duration PROCESSING_TTL = Duration.ofMinutes(1);
    static final Duration COMPLETED_TTL = Duration.ofHours(24);

    // 처리 중 표시가 그대로일 때만 지운다. 그 사이 끝난 응답이나 다른 요청의 표시는 남긴다
    private static final DefaultRedisScript<Long> RELEASE =
            new DefaultRedisScript<>(
                    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL',"
                            + " KEYS[1]) end return 0",
                    Long.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final StringRedisTemplate redis;

    public RedisIdempotencyStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public IdempotencyRecord begin(long userId, UUID key, String fingerprint) {
        String redisKey = key(userId, key);
        String processing = JSON.writeValueAsString(IdempotencyRecord.processing(fingerprint));
        if (Boolean.TRUE.equals(
                redis.opsForValue().setIfAbsent(redisKey, processing, PROCESSING_TTL))) {
            return null;
        }
        String existing = redis.opsForValue().get(redisKey);
        if (existing == null) {
            // 확인 사이에 처리 중 표시가 만료됐다. 다시 잡는다
            return begin(userId, key, fingerprint);
        }
        return JSON.readValue(existing, IdempotencyRecord.class);
    }

    @Override
    public void complete(long userId, UUID key, IdempotencyRecord record) {
        redis.opsForValue().set(key(userId, key), JSON.writeValueAsString(record), COMPLETED_TTL);
    }

    @Override
    public void release(long userId, UUID key, String fingerprint) {
        redis.execute(
                RELEASE,
                List.of(key(userId, key)),
                JSON.writeValueAsString(IdempotencyRecord.processing(fingerprint)));
    }

    private static String key(long userId, UUID key) {
        return "idem:" + userId + ":" + key;
    }
}
