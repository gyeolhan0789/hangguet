package com.ssafy.a301.interview.repository;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.ListOperations.MoveFrom;
import org.springframework.data.redis.core.ListOperations.MoveTo;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * BE 설계 7장의 ai:results 리스트. AI가 LPUSH하고, BE는 BLMOVE ai:results ai:results:processing RIGHT LEFT로
 * 꺼낸다(먼저 들어온 것부터). 다시 처리해도 안 되는 메시지는 ai:results:failed에 모아 둔다. 그룹 면접 결과 큐(ai:results:group, AI 명세
 * 1.4)도 같은 방식이고 처리 중 목록만 따로 둔다.
 */
@Component
public class RedisAiResultQueue implements AiResultQueue {
    static final String KEY = "ai:results";
    static final String FAILED = "ai:results:failed";

    private final StringRedisTemplate redis;
    private final String queueKey;
    private final String processing;

    @Autowired
    public RedisAiResultQueue(StringRedisTemplate redis) {
        this(redis, KEY);
    }

    private RedisAiResultQueue(StringRedisTemplate redis, String key) {
        this.redis = redis;
        this.queueKey = key;
        this.processing = key + ":processing";
    }

    /** 같은 방식의 다른 결과 큐. 처리 중 목록은 {key}:processing, 실패 목록은 ai:results:failed를 같이 쓴다 */
    public static RedisAiResultQueue of(StringRedisTemplate redis, String key) {
        return new RedisAiResultQueue(redis, key);
    }

    @Override
    public Optional<String> take(Duration timeout) {
        return Optional.ofNullable(
                redis.opsForList()
                        .move(MoveFrom.fromTail(queueKey), MoveTo.toHead(processing), timeout));
    }

    @Override
    public List<String> processing() {
        // 처리 중 목록은 앞(LEFT)에 넣으므로 뒤가 오래된 것이다
        List<String> messages = redis.opsForList().range(processing, 0, -1);
        List<String> oldestFirst = new ArrayList<>(messages == null ? List.of() : messages);
        Collections.reverse(oldestFirst);
        return oldestFirst;
    }

    @Override
    public void done(String message) {
        redis.opsForList().remove(processing, 1, message);
    }

    @Override
    public void fail(String message) {
        redis.opsForList().leftPush(FAILED, message);
        redis.opsForList().remove(processing, 1, message);
    }
}
