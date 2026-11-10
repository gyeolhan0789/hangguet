package com.ssafy.a301.admin.repository;

import com.ssafy.a301.common.crypto.Hashes;
import java.time.Duration;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * admin-login-fail:{SHA-256(아이디 + 요청 IP)} → 관리자 로그인(8.1)을 성공하지 못한 시도 횟수. 회원 로그인
 * 잠금(RedisLoginAttemptStore)과 같은 방식이다. 시도할 때마다 15분으로 다시 맞추므로 5번째 실패부터 15분 동안 잠기고, 잠긴 동안의 시도는 세지
 * 않는다. 아이디와 IP를 함께 세어, 다른 곳에서 틀린 시도가 관리자 계정을 잠그지 않게 한다. 요청 IP는 Nginx가 넣은
 * X-Forwarded-For다(forward-headers-strategy: framework).
 */
@Component
public class AdminLoginAttemptStore {
    static final int MAX_FAILURES = 5;
    static final Duration LOCK = Duration.ofMinutes(15);

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

    public AdminLoginAttemptStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /**
     * 비밀번호를 확인하기 전에 시도 한 번을 센다. 잠겨 있으면 세지 않고 남은 시간을, 아니면 0을 준다. 세는 일과 잠김 확인을 한 번에 해서 동시에 보낸 요청이 제한을
     * 넘지 못한다
     */
    public Duration tryAcquire(String loginId, String clientIp) {
        Long lockedMillis =
                redis.execute(
                        ACQUIRE,
                        List.of(key(loginId, clientIp)),
                        Integer.toString(MAX_FAILURES),
                        Long.toString(LOCK.toMillis()));
        return lockedMillis == null || lockedMillis <= 0
                ? Duration.ZERO
                : Duration.ofMillis(lockedMillis);
    }

    /** 로그인 성공. 센 횟수를 지운다 */
    public void reset(String loginId, String clientIp) {
        redis.delete(key(loginId, clientIp));
    }

    // 아이디 원문을 Redis 키에 남기지 않는다. 줄바꿈은 아이디에 들어갈 수 없어 두 값의 경계로 쓴다
    static String key(String loginId, String clientIp) {
        return "admin-login-fail:" + Hashes.sha256Hex(loginId + "\n" + clientIp);
    }
}
