package com.ssafy.a301.interview.config;

import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.RedisAiJobQueue;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tags;
import io.micrometer.core.instrument.binder.MeterBinder;
import java.util.function.DoubleSupplier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** AI 작업 흐름의 대기·실패 상태를 기존 BE 관리 포트에서 수집한다. */
@Component
public class AiQueueMetrics implements MeterBinder {
    // Grafana AI 작업 큐 패널이 sum by (queue)로 구분해 표시하는 태그 이름이다
    static final String QUEUE_TAG = "queue";

    private final StringRedisTemplate redis;
    private final InterviewSessionRepository sessions;

    public AiQueueMetrics(StringRedisTemplate redis, InterviewSessionRepository sessions) {
        this.redis = redis;
        this.sessions = sessions;
    }

    @Override
    public void bindTo(MeterRegistry registry) {
        // 작업 큐는 종류별로 나뉘어 있으므로(AI 명세 1.3) 큐마다 queue 태그를 붙여 질문 생성 대기열을 별도로 확인한다
        for (String key : RedisAiJobQueue.KEYS) {
            gauge(registry, "a301.ai.jobs.queued", Tags.of(QUEUE_TAG, key), () -> queueSize(key));
            gauge(
                    registry,
                    "a301.ai.jobs.processing",
                    Tags.of(QUEUE_TAG, key),
                    () -> queueSize(RedisAiJobQueue.processingKeyOf(key)));
        }
        gauge(
                registry,
                "a301.ai.results.failed",
                Tags.empty(),
                () -> queueSize("ai:results:failed"));
        gauge(
                registry,
                "a301.ai.sessions.failed",
                Tags.empty(),
                () -> sessions.countByStatus(SessionStatus.FAILED));
    }

    private double queueSize(String key) {
        Long size = redis.opsForList().size(key);
        return size == null ? Double.NaN : size.doubleValue();
    }

    private static void gauge(
            MeterRegistry registry, String name, Tags tags, DoubleSupplier measure) {
        Gauge.builder(
                        name,
                        () -> {
                            try {
                                return measure.getAsDouble();
                            } catch (RuntimeException unavailable) {
                                return Double.NaN;
                            }
                        })
                .tags(tags)
                .register(registry);
    }
}
