package com.ssafy.a301.interview.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
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
        message.put("companyName", "○○전자");

        queue.push(message);

        verify(lists)
                .leftPush(
                        "ai:jobs:plan",
                        "{\"jobType\":\"PLAN\",\"jobId\":\"8f0c\",\"sessionId\":55,\"companyName\":\"○○전자\"}");
    }

    // AI 작업자가 AI_WORKER_QUEUE로 읽는 큐 이름과 같아야 한다(AI 명세 1.3)
    @ParameterizedTest
    @CsvSource({
        "PLAN, ai:jobs:plan",
        "EXTRACT_CLAIMS, ai:jobs:plan",
        "MERGE_RECORDING, ai:jobs:recording",
        "SCORE_ANSWER, ai:jobs",
        "EVALUATE, ai:jobs",
        "UNKNOWN, ai:jobs"
    })
    void jobIsPushedToQueueOfItsType(String jobType, String key) {
        when(redis.opsForList()).thenReturn(lists);

        queue.push(Map.of("jobType", jobType));

        verify(lists).leftPush(key, "{\"jobType\":\"" + jobType + "\"}");
    }

    @Test
    void queueNamesAndProcessingListsMatchSpec() {
        assertThat(RedisAiJobQueue.KEYS)
                .containsExactly("ai:jobs", "ai:jobs:plan", "ai:jobs:recording");
        assertThat(RedisAiJobQueue.KEYS.stream().map(RedisAiJobQueue::processingKeyOf))
                .containsExactly(
                        "ai:jobs:processing",
                        "ai:jobs:plan:processing",
                        "ai:jobs:recording:processing");
    }
}
