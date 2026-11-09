package com.ssafy.a301.group.service;

import com.ssafy.a301.interview.repository.RedisAiResultQueue;
import com.ssafy.a301.interview.service.AiResultConsumer;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * 그룹 면접 결과 큐(ai:results:group, AI 명세 1.4)를 전용 스레드 하나로 처리한다(docs/그룹면접-설계.md 6.5). 결과 생성 저장처럼 무거운
 * 메시지가 섞인 ai:results 뒤에 차례 전환이 줄 서지 않게 하려고 큐를 나눴다. 다시 처리 · 실패 목록 규칙은 ai:results와 같다.
 */
@Component
public class GroupResultConsumer extends AiResultConsumer {
    static final String KEY = "ai:results:group";

    public GroupResultConsumer(
            StringRedisTemplate redis,
            GroupResultService results,
            @Value("${ai-result.consumer-enabled:true}") boolean enabled,
            @Value("${ai-result.retry-delay:5s}") Duration retryDelay) {
        super(
                RedisAiResultQueue.of(redis, KEY),
                results::handle,
                enabled,
                retryDelay,
                "group-result-consumer");
    }
}
