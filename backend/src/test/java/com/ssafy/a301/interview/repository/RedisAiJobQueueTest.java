package com.ssafy.a301.interview.repository;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

class RedisAiJobQueueTest {
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    @SuppressWarnings("unchecked")
    private final ListOperations<String, String> lists = mock(ListOperations.class);

    private final RedisAiJobQueue queue = new RedisAiJobQueue(redis);

    @Test
    void messageIsPushedAsJsonInFieldOrder() {
        when(redis.opsForList()).thenReturn(lists);
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("jobType", "PLAN");
        message.put("jobId", "8f0c");
        message.put("sessionId", 55L);
        message.put("coverLetter", "저는…");

        queue.push(message);

        verify(lists)
                .leftPush(
                        "ai:jobs",
                        "{\"jobType\":\"PLAN\",\"jobId\":\"8f0c\",\"sessionId\":55,\"coverLetter\":\"저는…\"}");
    }
}
