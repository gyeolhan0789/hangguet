package com.ssafy.a301.auth.repository;

import com.ssafy.a301.common.crypto.Hashes;
import java.time.Duration;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * login-fail:{SHA-256(정규화한 이메일)} → 성공하지 못한 시도 횟수. 시도할 때마다 15분으로 다시 맞추므로 5번째 실패부터 15분 동안 잠긴다. 잠긴 동안의
 * 시도는 세지 않아 잠김이 늘어나지 않는다. 가입하지 않은 이메일도 같게 세어 잠김 응답으로 가입 여부가 드러나지 않는다.
 */
@Component
public class RedisLoginAttemptStore implements LoginAttemptStore {
    private static final int MAX_FAILURES = 5;
    private static final Duration LOCK = Duration.ofMinutes(15);

    // 잠겼으면 남은 밀리초, 아니면 센 뒤 0
    private static final DefaultRedisScript<Long> ACQUIRE =
            new DefaultRedisScript<>(
                    """
                    local n = tonumber(redis.call('GET', KEYS[1]) or '0')
                    if n >= tonumber(ARGV[1]) then
                      local ttl = redis.call('PTTL', KEYS[1])
                      if ttl > 0 then return ttl end
                      redis.call('PEXPIRE', KEYS[1], ARGV[2])
                      return tonumber(ARGV[2])
                    end
                    redis.call('INCR', KEYS[1])
                    redis.call('PEXPIRE', KEYS[1], ARGV[2])
                    return 0
                    """,
                    Long.class);
    private final StringRedisTemplate redis;

    public RedisLoginAttemptStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public Duration tryAcquire(String email) {
        Long lockedMillis =
                redis.execute(
                        ACQUIRE,
                        List.of(key(email)),
                        Integer.toString(MAX_FAILURES),
                        Long.toString(LOCK.toMillis()));
        return lockedMillis == null || lockedMillis <= 0
                ? Duration.ZERO
                : Duration.ofMillis(lockedMillis);
    }

    @Override
    public void reset(String email) {
        redis.delete(key(email));
    }

    // 이메일 원문을 Redis 키에 남기지 않는다
    private static String key(String email) {
        return "login-fail:" + Hashes.sha256Hex(email);
    }
}
