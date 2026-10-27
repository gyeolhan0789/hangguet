package com.ssafy.a301.application.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.application.repository.CoverLetterCheckQueue.Verdict;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

// 기준: AI 명세 2.1 자기소개서 검증(ai:checks에 넣고 ai:checks:result:{jobId}를 8초 기다린다)
class RedisCoverLetterCheckQueueTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    @SuppressWarnings("unchecked")
    private final ListOperations<String, String> lists = mock(ListOperations.class);

    private final RedisCoverLetterCheckQueue queue = new RedisCoverLetterCheckQueue(redis);

    @BeforeEach
    void setUp() {
        when(redis.opsForList()).thenReturn(lists);
    }

    private Verdict checkWithResult(String result) {
        when(lists.rightPop(anyString(), eq(RedisCoverLetterCheckQueue.WAIT))).thenReturn(result);
        return queue.check("○○전자", "백엔드", "저는…");
    }

    @Test
    void messageGoesToCheckQueueAndResultIsReadFromItsKey() {
        assertThat(checkWithResult("{\"usable\":true}")).isEqualTo(Verdict.USABLE);

        ArgumentCaptor<String> sent = ArgumentCaptor.forClass(String.class);
        verify(lists).leftPush(eq(RedisCoverLetterCheckQueue.QUEUE_KEY), sent.capture());
        JsonNode message = JSON.readTree(sent.getValue());
        assertThat(message.get("companyName").asString()).isEqualTo("○○전자");
        assertThat(message.get("jobTitle").asString()).isEqualTo("백엔드");
        assertThat(message.get("coverLetter").asString()).isEqualTo("저는…");
        assertThat(message.get("requestedAt").asString()).endsWith("+09:00");
        verify(lists)
                .rightPop(
                        RedisCoverLetterCheckQueue.RESULT_KEY_PREFIX
                                + message.get("jobId").asString(),
                        RedisCoverLetterCheckQueue.WAIT);
    }

    @Test
    void verdictFollowsResult() {
        assertThat(checkWithResult("{\"usable\":false}")).isEqualTo(Verdict.UNUSABLE);
        assertThat(checkWithResult("{\"error\":\"CHECK_FAILED\"}")).isEqualTo(Verdict.UNAVAILABLE);
        assertThat(checkWithResult("{\"usable\":\"yes\"}")).isEqualTo(Verdict.UNAVAILABLE);
        assertThat(checkWithResult("not json")).isEqualTo(Verdict.UNAVAILABLE);
        // 기다리는 시간 안에 결과가 오지 않았다
        assertThat(checkWithResult(null)).isEqualTo(Verdict.UNAVAILABLE);
    }

    @Test
    void redisFailureIsUnavailable() {
        when(lists.leftPush(anyString(), anyString()))
                .thenThrow(new RedisConnectionFailureException("down"));

        assertThat(queue.check("○○전자", "백엔드", "저는…")).isEqualTo(Verdict.UNAVAILABLE);
    }
}
