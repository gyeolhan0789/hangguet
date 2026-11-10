package com.ssafy.a301.auth.repository;

import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.common.crypto.Hashes;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * refresh:{SHA-256(token)} → "회원 id:로그인 시각(epoch 밀리초)". 로그인 시각이 없는 예전 값("회원 id")은 아주 오래전 로그인으로 본다.
 * 탈퇴 때 모든 기기 토큰을 지울 수 있도록 refresh-user:{userId} 정렬 집합에 회원별 토큰 키를 만료 시각(epoch 초)을 점수로 남긴다. 발급할 때 만료
 * 시각이 지난 키를 정리하므로 쓰지 않게 된 기기의 키가 쌓이지 않는다.
 */
@Component
public class RedisRefreshTokenStore implements RefreshTokenStore {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final DefaultRedisScript<Long> REVOKE =
            new DefaultRedisScript<>(
                    "local v = redis.call('GET', KEYS[1]) if v and (v == ARGV[1] or"
                            + " string.sub(v, 1, string.len(ARGV[1]) + 1) == ARGV[1] .. ':')"
                            + " then return redis.call('DEL', KEYS[1]) end return 0",
                    Long.class);
    private final StringRedisTemplate redis;
    private final AuthProperties properties;

    public RedisRefreshTokenStore(StringRedisTemplate redis, AuthProperties properties) {
        this.redis = redis;
        this.properties = properties;
    }

    @Override
    public String issue(long userId, Instant authenticatedAt) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        String key = key(token);
        redis.opsForValue()
                .set(key, userId + ":" + authenticatedAt.toEpochMilli(), properties.refreshTtl());
        String userKey = userKey(userId);
        long now = Instant.now().getEpochSecond();
        redis.opsForZSet().removeRangeByScore(userKey, Double.NEGATIVE_INFINITY, now);
        redis.opsForZSet().add(userKey, key, (double) now + properties.refreshTtl().toSeconds());
        redis.expire(userKey, properties.refreshTtl());
        return token;
    }

    @Override
    public RefreshSession consume(String token) {
        String key = key(token);
        String value = redis.opsForValue().getAndDelete(key);
        if (value == null) {
            return null;
        }
        int colon = value.indexOf(':');
        long userId = Long.parseLong(colon < 0 ? value : value.substring(0, colon));
        Instant authenticatedAt =
                colon < 0
                        ? Instant.EPOCH
                        : Instant.ofEpochMilli(Long.parseLong(value.substring(colon + 1)));
        redis.opsForZSet().remove(userKey(userId), key);
        return new RefreshSession(userId, authenticatedAt);
    }

    @Override
    public void revoke(String token, long userId) {
        String key = key(token);
        Long deleted = redis.execute(REVOKE, List.of(key), Long.toString(userId));
        if (deleted != null && deleted > 0) {
            redis.opsForZSet().remove(userKey(userId), key);
        }
    }

    @Override
    public void revokeAll(long userId) {
        String userKey = userKey(userId);
        Set<String> keys = redis.opsForZSet().range(userKey, 0, -1);
        List<String> targets = new ArrayList<>(keys == null ? Set.of() : keys);
        targets.add(userKey);
        redis.delete(targets);
    }

    private static String userKey(long userId) {
        return "refresh-user:" + userId;
    }

    // Redis에도 원본 bearer credential을 저장하지 않는다.
    private static String key(String token) {
        return "refresh:" + Hashes.sha256Hex(token);
    }
}
