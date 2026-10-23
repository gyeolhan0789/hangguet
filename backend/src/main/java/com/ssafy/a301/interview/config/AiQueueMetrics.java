package com.ssafy.a301.interview.config;

import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.binder.MeterBinder;
import java.util.function.DoubleSupplier;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** AI 작업 흐름의 대기·실패 상태를 기존 BE 관리 포트에서 수집한다. */
@Component
public class AiQueueMetrics implements MeterBinder {
    private final StringRedisTemplate redis;
    private final InterviewSessionRepository sessions;

    public AiQueueMetrics(StringRedisTemplate redis, InterviewSessionRepository sessions) {
        this.redis = redis;
        this.sessions = sessions;
    }

    @Override
    public void bindTo(MeterRegistry registry) {
        gauge(registry, "a301.ai.jobs.queued", () -> queueSize("ai:jobs"));
        gauge(registry, "a301.ai.jobs.processing", () -> queueSize("ai:jobs:processing"));
        gauge(registry, "a301.ai.results.failed", () -> queueSize("ai:results:failed"));
        gauge(
                registry,
                "a301.ai.sessions.failed",
                () -> sessions.countByStatus(SessionStatus.FAILED));
    }

    private double queueSize(String key) {
        Long size = redis.opsForList().size(key);
        return size == null ? Double.NaN : size.doubleValue();
    }

    private static void gauge(MeterRegistry registry, String name, DoubleSupplier measure) {
        Gauge.builder(
                        name,
                        () -> {
                            try {
                                return measure.getAsDouble();
                            } catch (RuntimeException unavailable) {
                                return Double.NaN;
                            }
                        })
                .register(registry);
    }
}
