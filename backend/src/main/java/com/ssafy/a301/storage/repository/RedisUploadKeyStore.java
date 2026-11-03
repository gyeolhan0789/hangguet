package com.ssafy.a301.storage.repository;

import com.ssafy.a301.storage.domain.UploadPurpose;
import java.time.Duration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** BE 설계 7장의 upload:{objectKey} 키. 값은 "회원 id:용도"(받는 사람이 없으면 용도만), TTL은 부르는 쪽이 정한다. */
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

    @Override
    public void issueOnce(String objectKey, UploadPurpose purpose, Duration ttl) {
        redis.opsForValue().set(key(objectKey), purpose.name(), ttl);
    }

    @Override
    public boolean isIssued(String objectKey, UploadPurpose purpose) {
        return purpose.name().equals(redis.opsForValue().get(key(objectKey)));
    }

    // 읽고 지우기를 한 번에 해(GETDEL) 같은 키를 동시에 보내도 하나만 쓴다
    @Override
    public boolean use(String objectKey, UploadPurpose purpose) {
        return purpose.name().equals(redis.opsForValue().getAndDelete(key(objectKey)));
    }

    private static String key(String objectKey) {
        return "upload:" + objectKey;
    }

    private static String value(long userId, UploadPurpose purpose) {
        return userId + ":" + purpose.name();
    }
}
