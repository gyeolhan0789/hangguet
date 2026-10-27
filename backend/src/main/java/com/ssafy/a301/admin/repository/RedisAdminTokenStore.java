package com.ssafy.a301.admin.repository;

import com.ssafy.a301.common.crypto.Hashes;
import java.time.Duration;
import java.time.Instant;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** admin-logout:{SHA-256(token)} → "1". 토큰의 만료 시각이 지나면 키도 사라진다. */
@Component
public class RedisAdminTokenStore implements AdminTokenStore {
    private final StringRedisTemplate redis;

    public RedisAdminTokenStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public void revoke(String token, Instant expiresAt) {
        Duration ttl = Duration.between(Instant.now(), expiresAt);
        if (ttl.isNegative() || ttl.isZero()) {
            return;
        }
        redis.opsForValue().set(key(token), "1", ttl);
    }

    @Override
    public boolean isRevoked(String token) {
        return Boolean.TRUE.equals(redis.hasKey(key(token)));
    }

    private static String key(String token) {
        return "admin-logout:" + Hashes.sha256Hex(token);
    }
}
