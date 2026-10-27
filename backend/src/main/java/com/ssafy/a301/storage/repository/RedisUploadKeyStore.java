package com.ssafy.a301.storage.repository;

import com.ssafy.a301.storage.domain.UploadPurpose;
import java.time.Duration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** BE 설계 7장의 upload:{objectKey} 키. 값은 "회원 id:용도", TTL은 업로드 주소 만료와 같다. */
@Component
public class RedisUploadKeyStore implements UploadKeyStore {
    private final StringRedisTemplate redis;

    public RedisUploadKeyStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public void issue(String objectKey, long userId, UploadPurpose purpose, Duration ttl) {
        redis.opsForValue().set(key(objectKey), value(userId, purpose), ttl);
    }

    @Override
    public boolean isIssuedTo(String objectKey, long userId, UploadPurpose purpose) {
        return value(userId, purpose).equals(redis.opsForValue().get(key(objectKey)));
    }

    private static String key(String objectKey) {
        return "upload:" + objectKey;
    }

    private static String value(long userId, UploadPurpose purpose) {
        return userId + ":" + purpose.name();
    }
}
