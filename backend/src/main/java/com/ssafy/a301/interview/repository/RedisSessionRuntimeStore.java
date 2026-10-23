package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * BE 설계 7장의 session:{sessionId}:runtime Hash. 필드는
 * planStatus·planProgress·analysisStep·pausedSeconds·planStartedAt· analysisStartedAt이고, 값이 없으면 필드가
 * 없다. BE만 쓰며(AI 진행 상황은 결과 메시지로 받음) 필드마다 HSET해 요청 처리와 결과 처리가 서로의 값을 덮어쓰지 않는다. BE가 쓸 때마다 TTL을 1일로 다시
 * 잡아, 결과 생성을 시작한(면접 종료) 뒤 1일이 지나면 사라진다.
 */
@Component
public class RedisSessionRuntimeStore implements SessionRuntimeStore {
    static final Duration TTL = Duration.ofDays(1);
    static final String PLAN_STATUS = "planStatus";
    static final String PLAN_PROGRESS = "planProgress";
    static final String ANALYSIS_STEP = "analysisStep";
    static final String PAUSED_SECONDS = "pausedSeconds";
    // 플랜 생성을 시작한 시각(epoch 밀리초). 최대 대기 시간 확인용
    static final String PLAN_STARTED_AT = "planStartedAt";
    // 결과 생성을 시작한 시각(epoch 밀리초). 최대 대기 시간 확인용
    static final String ANALYSIS_STARTED_AT = "analysisStartedAt";

    // 아직 GENERATING일 때만 FAILED로 바꾼다. 확인과 쓰기 사이에 플랜 결과가 처리돼 READY가 됐으면 그대로 둔다
    private static final DefaultRedisScript<Long> FAIL_PLAN =
            new DefaultRedisScript<>(
                    "if redis.call('HGET', KEYS[1], 'planStatus') == 'GENERATING' then"
                            + " redis.call('HSET', KEYS[1], 'planStatus', 'FAILED')"
                            + " redis.call('HDEL', KEYS[1], 'planProgress') return 1 end return 0",
                    Long.class);

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
    public void startPlan(long sessionId, Instant now) {
        String key = key(sessionId);
        hash().putAll(
                        key,
                        Map.of(
                                PLAN_STATUS,
                                PlanStatus.GENERATING.name(),
                                PLAN_PROGRESS,
                                "0",
                                PLAN_STARTED_AT,
                                Long.toString(now.toEpochMilli())));
        redis.expire(key, TTL);
    }

    @Override
    public Optional<Instant> findPlanStartedAt(long sessionId) {
        return findInstant(sessionId, PLAN_STARTED_AT);
    }

    @Override
    public void updatePlanProgress(long sessionId, int progress) {
        String key = key(sessionId);
        hash().put(key, PLAN_PROGRESS, Integer.toString(progress));
        redis.expire(key, TTL);
    }

    @Override
    public void markPlanReady(long sessionId) {
        String key = key(sessionId);
        hash().put(key, PLAN_STATUS, PlanStatus.READY.name());
        hash().delete(key, PLAN_PROGRESS);
        redis.expire(key, TTL);
    }

    @Override
    public void failPlanIfGenerating(long sessionId) {
        redis.execute(FAIL_PLAN, List.of(key(sessionId)));
    }

    @Override
    public void startAnalysis(long sessionId, Instant now) {
        String key = key(sessionId);
        hash().putAll(
                        key,
                        Map.of(
                                ANALYSIS_STEP,
                                AnalysisStep.ORGANIZING_ANSWERS.name(),
                                ANALYSIS_STARTED_AT,
                                Long.toString(now.toEpochMilli())));
        redis.expire(key, TTL);
    }

    @Override
    public Optional<Instant> findAnalysisStartedAt(long sessionId) {
        return findInstant(sessionId, ANALYSIS_STARTED_AT);
    }

    private Optional<Instant> findInstant(long sessionId, String field) {
        return Optional.ofNullable(hash().get(key(sessionId), field))
                .map(value -> Instant.ofEpochMilli(Long.parseLong(value)));
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
