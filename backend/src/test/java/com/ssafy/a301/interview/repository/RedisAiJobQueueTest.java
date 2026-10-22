package com.ssafy.a301.interview.repository;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.interview.domain.AiJob;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

class RedisAiJobQueueTest {
    private static final UUID JOB_ID = UUID.fromString("8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34");

    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    @SuppressWarnings("unchecked")
    private final ListOperations<String, String> lists = mock(ListOperations.class);

    private final RedisAiJobQueue queue = new RedisAiJobQueue(redis);

    @Test
    void scoreAnswerMessageHasAnswerId() {
        when(redis.opsForList()).thenReturn(lists);

        queue.push(withId(AiJob.scoreAnswer(55L, 903L)));

        verify(lists)
                .leftPush(
                        "ai:jobs",
                        "{\"jobType\":\"SCORE_ANSWER\",\"jobId\":\""
                                + JOB_ID
                                + "\",\"sessionId\":55,\"answerId\":903}");
    }

    @Test
    void otherMessagesHaveNoAnswerId() {
        when(redis.opsForList()).thenReturn(lists);

        queue.push(withId(AiJob.plan(55L)));
        queue.push(withId(AiJob.evaluate(55L)));

        verify(lists)
                .leftPush(
                        "ai:jobs",
                        "{\"jobType\":\"PLAN\",\"jobId\":\"" + JOB_ID + "\",\"sessionId\":55}");
        verify(lists)
                .leftPush(
                        "ai:jobs",
                        "{\"jobType\":\"EVALUATE\",\"jobId\":\"" + JOB_ID + "\",\"sessionId\":55}");
    }

    private static AiJob withId(AiJob job) {
        ReflectionTestUtils.setField(job, "id", JOB_ID);
        return job;
    }
}
