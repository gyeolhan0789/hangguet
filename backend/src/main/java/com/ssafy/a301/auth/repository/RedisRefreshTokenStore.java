package com.ssafy.a301.auth.repository;

import com.ssafy.a301.auth.jwt.AuthProperties;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

@Component
public class RedisRefreshTokenStore implements RefreshTokenStore {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final DefaultRedisScript<Long> REVOKE =
            new DefaultRedisScript<>(
                    "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL',"
                            + " KEYS[1]) end return 0",
                    Long.class);
    private final StringRedisTemplate redis;
    private final AuthProperties properties;

    public RedisRefreshTokenStore(StringRedisTemplate redis, AuthProperties properties) {
        this.redis = redis;
        this.properties = properties;
    }

    @Override
    public String issue(long userId) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        redis.opsForValue().set(key(token), Long.toString(userId), properties.refreshTtl());
        return token;
    }

    @Override
    public Long consume(String token) {
        String value = redis.opsForValue().getAndDelete(key(token));
        return value == null ? null : Long.valueOf(value);
    }

    @Override
    public void revoke(String token, long userId) {
        redis.execute(REVOKE, List.of(key(token)), Long.toString(userId));
    }

    // Redis에도 원본 bearer credential을 저장하지 않는다.
    private static String key(String token) {
        try {
            return "refresh:"
                    + HexFormat.of()
                            .formatHex(
                                    MessageDigest.getInstance("SHA-256")
                                            .digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
