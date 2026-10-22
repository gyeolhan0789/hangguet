package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/**
 * BE 설계 7장의 session:{sessionId}:runtime Hash. 필드는 planStatus·planProgress·analysisStep(작업자도 씀)과
 * pausedSeconds(BE만 씀)이고, 값이 없으면 필드가 없다. 필드마다 HSET하므로 작업자와 BE가 서로의 값을 덮어쓰지 않는다. BE가 쓸 때마다 TTL을 1일로
 * 다시 잡아, 결과 생성을 시작한(면접 종료) 뒤 1일이 지나면 사라진다.
 */
@Component
public class RedisSessionRuntimeStore implements SessionRuntimeStore {
    static final Duration TTL = Duration.ofDays(1);
    static final String PLAN_STATUS = "planStatus";
    static final String PLAN_PROGRESS = "planProgress";
    static final String ANALYSIS_STEP = "analysisStep";
    static final String PAUSED_SECONDS = "pausedSeconds";

    private final StringRedisTemplate redis;

    public RedisSessionRuntimeStore(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public Optional<SessionRuntime> find(long sessionId) {
        Map<String, String> fields = hash().entries(key(sessionId));
        if (fields.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(
                new SessionRuntime(
                        parse(fields, PLAN_STATUS, PlanStatus::valueOf),
                        parse(fields, PLAN_PROGRESS, Integer::valueOf),
                        parse(fields, ANALYSIS_STEP, AnalysisStep::valueOf),
                        fields.containsKey(PAUSED_SECONDS)
                                ? Long.parseLong(fields.get(PAUSED_SECONDS))
                                : 0));
    }

    @Override
    public void startPlan(long sessionId) {
        String key = key(sessionId);
        hash().putAll(key, Map.of(PLAN_STATUS, PlanStatus.GENERATING.name(), PLAN_PROGRESS, "0"));
        redis.expire(key, TTL);
    }

    @Override
    public void startAnalysis(long sessionId) {
        String key = key(sessionId);
        hash().put(key, ANALYSIS_STEP, AnalysisStep.ORGANIZING_ANSWERS.name());
        redis.expire(key, TTL);
    }

    private HashOperations<String, String, String> hash() {
        return redis.opsForHash();
    }

    private static <T> T parse(
            Map<String, String> fields, String name, Function<String, T> parser) {
        String value = fields.get(name);
        return value == null ? null : parser.apply(value);
    }

    private static String key(long sessionId) {
        return "session:" + sessionId + ":runtime";
    }
}
