package com.ssafy.a301.admin.repository;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
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
        try {
            byte[] hash =
                    MessageDigest.getInstance("SHA-256")
                            .digest(token.getBytes(StandardCharsets.UTF_8));
            return "admin-logout:" + HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
