package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.interview.repository.RedisAiResultQueue;
import com.ssafy.a301.interview.service.AiResultService.Outcome;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/**
 * 실행 중인 Redis로 결과 큐 처리기가 메시지를 꺼내 처리 중 목록을 거쳐 지우는지, 저장할 수 없는 메시지는 실패 목록으로 옮기는지, 지난번에 남은 메시지를 먼저
 * 처리하는지 확인한다. 저장은 가짜이며 결과 큐 키만 지운다.
 */
@Tag("redis-integration")
class AiResultConsumerIntegrationTest {
    private static final List<String> KEYS =
            List.of("ai:results", "ai:results:processing", "ai:results:failed");

    private final AiResultService results = mock(AiResultService.class);
    private LettuceConnectionFactory connection;
    private StringRedisTemplate redis;
    private AiResultConsumer consumer;

    @BeforeEach
    void setUp() {
        connection =
                new LettuceConnectionFactory(
                        System.getenv().getOrDefault("REDIS_HOST", "localhost"),
                        Integer.parseInt(System.getenv().getOrDefault("REDIS_PORT", "6379")));
        connection.afterPropertiesSet();
        connection.start();
        redis = new StringRedisTemplate(connection);
        redis.delete(KEYS);
        consumer =
                new AiResultConsumer(
                        new RedisAiResultQueue(redis), results, true, Duration.ofMillis(50));
    }

    @AfterEach
    void tearDown() {
        consumer.stop();
        redis.delete(KEYS);
        connection.destroy();
    }

    @Test
    void savedMessageIsRemovedFromProcessing() throws Exception {
        when(results.handle("m1")).thenReturn(Outcome.SAVED);
        consumer.start();

        redis.opsForList().leftPush("ai:results", "m1");

        verify(results, timeout(5_000)).handle("m1");
        awaitEmpty("ai:results:processing");
    }

    @Test
    void invalidMessageMovesToFailedList() throws Exception {
        when(results.handle("bad")).thenThrow(new InvalidAiResultException("형식 오류"));
        consumer.start();

        redis.opsForList().leftPush("ai:results", "bad");

        verify(results, timeout(5_000)).handle("bad");
        awaitEmpty("ai:results:processing");
        assertThat(redis.opsForList().range("ai:results:failed", 0, -1)).containsExactly("bad");
    }

    @Test
    void leftOverMessagesAreProcessedFirstInOrder() throws Exception {
        // 지난번에 처리 도중 멈췄다: 처리 중 목록은 앞에 넣으므로 m-old가 먼저 들어온 것이다
        redis.opsForList().leftPush("ai:results:processing", "m-old");
        redis.opsForList().leftPush("ai:results:processing", "m-new");
        when(results.handle("m-old")).thenReturn(Outcome.SAVED);
        when(results.handle("m-new")).thenReturn(Outcome.SAVED);

        consumer.start();

        InOrder order = inOrder(results);
        order.verify(results, timeout(5_000)).handle("m-old");
        order.verify(results, timeout(5_000)).handle("m-new");
        awaitEmpty("ai:results:processing");
    }

    @Test
    void temporaryFailureIsRetriedWithSameMessage() throws Exception {
        when(results.handle("m1"))
                .thenThrow(new QueryTimeoutException("DB 응답 시간 초과"))
                .thenReturn(Outcome.SAVED);
        consumer.start();

        redis.opsForList().leftPush("ai:results", "m1");

        verify(results, timeout(5_000).times(2)).handle("m1");
        awaitEmpty("ai:results:processing");
        assertThat(redis.opsForList().size("ai:results:failed")).isZero();
        verify(results, times(2)).handle("m1");
    }

    @Test
    void unexpectedFailureMovesToFailedListAndDoesNotBlockNext() throws Exception {
        // 예: 질문 글이 null이라 NOT NULL 위반. 다시 해도 같으므로 뒤의 메시지를 막지 않는다
        when(results.handle("broken"))
                .thenThrow(new DataIntegrityViolationException("not-null 위반"));
        when(results.handle("m2")).thenReturn(Outcome.SAVED);
        consumer.start();

        redis.opsForList().leftPush("ai:results", "broken");
        redis.opsForList().leftPush("ai:results", "m2");

        verify(results, timeout(5_000)).handle("m2");
        awaitEmpty("ai:results:processing");
        assertThat(redis.opsForList().range("ai:results:failed", 0, -1)).containsExactly("broken");
        verify(results, times(1)).handle("broken");
    }

    private void awaitEmpty(String key) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (redis.opsForList().size(key) > 0) {
            assertThat(System.nanoTime()).as(key + " 비우기 대기").isLessThan(deadline);
            Thread.sleep(20);
        }
    }
}
