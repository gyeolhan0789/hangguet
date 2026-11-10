package com.ssafy.a301.inquiry.repository;

import java.time.Duration;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * inquiry-fail:{문의 id} → 비회원 문의 조회 비밀번호(9.3 ~ 9.5)를 맞히지 못한 시도 횟수. 로그인 잠금(RedisLoginAttemptStore)과
 * 같은 방식이다. 시도할 때마다 15분으로 다시 맞추므로 5번째 실패부터 15분 동안 잠기고, 잠긴 동안의 시도는 세지 않는다. 문의 번호는 순번이고 조회 비밀번호는 4자부터라
 * 제한이 없으면 무작위로 맞혀 볼 수 있기 때문이다.
 */
@Component
public class InquiryAttemptStore {
    static final int MAX_FAILURES = 5;
    static final Duration LOCK = Duration.ofMinutes(15);

    // 잠겼으면 1, 아니면 센 뒤 0
    private static final DefaultRedisScript<Long> ACQUIRE =
            new DefaultRedisScript<>(
                    """
                    local n = tonumber(redis.call('GET', KEYS[1]) or '0')
                    if n >= tonumber(ARGV[1]) then
                      if redis.call('PTTL', KEYS[1]) <= 0 then
                        redis.call('PEXPIRE', KEYS[1], ARGV[2])
                      end
                      return 1
                    end
                    redis.call('INCR', KEYS[1])
                    redis.call('PEXPIRE', KEYS[1], ARGV[2])
                    return 0
                    """,
                    Long.class);
    private final StringRedisTemplate redis;

    public InquiryAttemptStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /**
     * 비밀번호를 확인하기 전에 시도 한 번을 센다. 잠겨 있으면 세지 않고 true를 준다. 세는 일과 잠김 확인을 한 번에 해서 동시에 보낸 요청이 제한을 넘지 못한다
     */
    public boolean locked(long inquiryId) {
        Long result =
                redis.execute(
                        ACQUIRE,
                        List.of(key(inquiryId)),
                        Integer.toString(MAX_FAILURES),
                        Long.toString(LOCK.toMillis()));
        return result != null && result == 1L;
    }

    /** 비밀번호를 맞혔다. 센 횟수를 지운다 */
    public void reset(long inquiryId) {
        redis.delete(key(inquiryId));
    }

    static String key(long inquiryId) {
        return "inquiry-fail:" + inquiryId;
    }
}
