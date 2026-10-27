package com.ssafy.a301.interview.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.ListOperations;
import org.springframework.data.redis.core.StringRedisTemplate;

class AiQueueMetricsTest {
    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    @SuppressWarnings("unchecked")
    private final ListOperations<String, String> lists = mock(ListOperations.class);

    private final InterviewSessionRepository sessions = mock(InterviewSessionRepository.class);
    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();

    @BeforeEach
    void bind() {
        when(redis.opsForList()).thenReturn(lists);
        Map.of(
                        "ai:jobs", 1L,
                        "ai:jobs:processing", 2L,
                        "ai:jobs:plan", 3L,
                        "ai:jobs:plan:processing", 4L,
                        "ai:jobs:recording", 5L,
                        "ai:jobs:recording:processing", 6L,
                        "ai:results:failed", 7L)
                .forEach((key, size) -> when(lists.size(key)).thenReturn(size));
        when(sessions.countByStatus(SessionStatus.FAILED)).thenReturn(8L);
        new AiQueueMetrics(redis, sessions).bindTo(registry);
    }

    @Test
    void queueLengthsAreTaggedByQueue() {
        assertThat(gauge("a301.ai.jobs.queued", "ai:jobs")).isEqualTo(1);
        assertThat(gauge("a301.ai.jobs.processing", "ai:jobs")).isEqualTo(2);
        assertThat(gauge("a301.ai.jobs.queued", "ai:jobs:plan")).isEqualTo(3);
        assertThat(gauge("a301.ai.jobs.processing", "ai:jobs:plan")).isEqualTo(4);
        assertThat(gauge("a301.ai.jobs.queued", "ai:jobs:recording")).isEqualTo(5);
        assertThat(gauge("a301.ai.jobs.processing", "ai:jobs:recording")).isEqualTo(6);
        assertThat(registry.find("a301.ai.jobs.queued").gauges()).hasSize(3);
    }

    @Test
    void failureGaugesStayUntagged() {
        assertThat(registry.get("a301.ai.results.failed").gauge().value()).isEqualTo(7);
        assertThat(registry.get("a301.ai.sessions.failed").gauge().value()).isEqualTo(8);
    }

    @Test
    void unavailableRedisIsNotANumberInsteadOfError() {
        when(lists.size("ai:jobs:plan")).thenThrow(new IllegalStateException("Redis 연결 실패"));

        assertThat(gauge("a301.ai.jobs.queued", "ai:jobs:plan")).isNaN();
    }

    // 태그 이름은 Grafana 패널(sum by (queue))과의 약속이므로 상수가 아니라 값으로 확인한다
    private double gauge(String name, String queue) {
        return registry.get(name).tag("queue", queue).gauge().value();
    }
}
