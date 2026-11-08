package com.ssafy.a301.auth.repository;

import com.ssafy.a301.auth.reset.PasswordResetProperties;
import com.ssafy.a301.common.crypto.Hashes;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * password-reset:{SHA-256(token)} → "회원 id:발급 시각(epoch 밀리초)", password-reset.token-ttl 뒤에 사라진다.
 * password-reset-wait:{SHA-256(정규화한 이메일)} → "1", password-reset.resend-interval 동안 같은 이메일의 재요청을 막는다
 */
@Component
public class RedisPasswordResetTokenStore implements PasswordResetTokenStore {
    private static final SecureRandom RANDOM = new SecureRandom();
    private final StringRedisTemplate redis;
    private final PasswordResetProperties properties;

    public RedisPasswordResetTokenStore(
            StringRedisTemplate redis, PasswordResetProperties properties) {
        this.redis = redis;
        this.properties = properties;
    }

    @Override
    public boolean tryStartResendInterval(String email) {
        return Boolean.TRUE.equals(
                redis.opsForValue()
                        .setIfAbsent(
                                "password-reset-wait:" + Hashes.sha256Hex(email),
                                "1",
                                properties.resendInterval()));
    }

    @Override
    public String issue(long userId) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        redis.opsForValue()
                .set(
                        key(token),
                        userId + ":" + Instant.now().toEpochMilli(),
                        properties.tokenTtl());
        return token;
    }

    @Override
    public ResetToken consume(String token) {
        String value = redis.opsForValue().getAndDelete(key(token));
        if (value == null) {
            return null;
        }
        int colon = value.indexOf(':');
        return new ResetToken(
                Long.parseLong(value.substring(0, colon)),
                Instant.ofEpochMilli(Long.parseLong(value.substring(colon + 1))));
    }

    // 리프레시 토큰처럼 원문을 Redis에 남기지 않는다
    private static String key(String token) {
        return "password-reset:" + Hashes.sha256Hex(token);
    }
}
