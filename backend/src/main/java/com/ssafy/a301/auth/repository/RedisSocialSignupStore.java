package com.ssafy.a301.auth.repository;

import com.ssafy.a301.auth.oauth.OAuthProperties;
import com.ssafy.a301.auth.oauth.SocialProfile;
import com.ssafy.a301.common.crypto.Hashes;
import java.security.SecureRandom;
import java.util.Base64;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * social-signup:{SHA-256(token)} → SocialProfile JSON. 가입에 성공하면 지우고, 아니면 oauth.signup-token-ttl 뒤에
 * 사라진다
 */
@Component
public class RedisSocialSignupStore implements SocialSignupStore {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final StringRedisTemplate redis;
    private final OAuthProperties properties;

    public RedisSocialSignupStore(StringRedisTemplate redis, OAuthProperties properties) {
        this.redis = redis;
        this.properties = properties;
    }

    @Override
    public String issue(SocialProfile profile) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        redis.opsForValue()
                .set(key(token), JSON.writeValueAsString(profile), properties.signupTokenTtl());
        return token;
    }

    @Override
    public SocialProfile find(String token) {
        String value = redis.opsForValue().get(key(token));
        return value == null ? null : JSON.readValue(value, SocialProfile.class);
    }

    @Override
    public void delete(String token) {
        redis.delete(key(token));
    }

    // 리프레시 토큰처럼 원문을 Redis에 남기지 않는다
    private static String key(String token) {
        return "social-signup:" + Hashes.sha256Hex(token);
    }
}
