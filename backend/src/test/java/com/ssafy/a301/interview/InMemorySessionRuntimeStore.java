package com.ssafy.a301.interview;

import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.repository.SessionRuntimeStore;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** RedisSessionRuntimeStore 대신 쓰는 메모리 저장소. 일반 테스트가 Redis 없이 돌도록 @Import(Config.class)로 바꿔 끼운다. */
public class InMemorySessionRuntimeStore implements SessionRuntimeStore {
    public final Map<Long, SessionRuntime> values = new ConcurrentHashMap<>();
    public final Map<Long, Instant> planStartedAt = new ConcurrentHashMap<>();
    public final Map<Long, Instant> analysisStartedAt = new ConcurrentHashMap<>();
    public final Map<Long, UUID> evaluateJobIds = new ConcurrentHashMap<>();

    public void clear() {
        values.clear();
        planStartedAt.clear();
        analysisStartedAt.clear();
        evaluateJobIds.clear();
    }

    @Override
    public Optional<SessionRuntime> find(long sessionId) {
        return Optional.ofNullable(values.get(sessionId));
    }

    @Override
    public void startPlan(long sessionId, Instant now) {
        values.put(sessionId, SessionRuntime.generating());
        planStartedAt.put(sessionId, now);
    }

    @Override
    public Optional<Instant> findPlanStartedAt(long sessionId) {
        return Optional.ofNullable(planStartedAt.get(sessionId));
    }

    @Override
    public void updatePlanProgress(long sessionId, int progress) {
        values.computeIfPresent(
                sessionId,
                (id, runtime) ->
                        new SessionRuntime(
                                runtime.planStatus(),
                                progress,
                                runtime.analysisStep(),
                                runtime.pausedSeconds()));
    }

    @Override
    public void markPlanReady(long sessionId) {
        SessionRuntime runtime = values.get(sessionId);
        values.put(
                sessionId,
                runtime == null
                        ? new SessionRuntime(PlanStatus.READY, null, null, 0)
                        : new SessionRuntime(
                                PlanStatus.READY,
                                null,
                                runtime.analysisStep(),
                                runtime.pausedSeconds()));
    }

    @Override
    public void failPlanIfGenerating(long sessionId) {
        values.computeIfPresent(
                sessionId,
                (id, runtime) ->
                        runtime.planStatus() == PlanStatus.GENERATING
                                ? new SessionRuntime(PlanStatus.FAILED, null, null, 0)
                                : runtime);
    }

    @Override
    public void startAnalysis(long sessionId, Instant now, UUID evaluateJobId) {
        updateAnalysisStep(sessionId, AnalysisStep.ORGANIZING_ANSWERS);
        analysisStartedAt.put(sessionId, now);
        evaluateJobIds.put(sessionId, evaluateJobId);
    }

    @Override
    public Optional<UUID> findEvaluateJobId(long sessionId) {
        return Optional.ofNullable(evaluateJobIds.get(sessionId));
    }

    @Override
    public void updateAnalysisStep(long sessionId, AnalysisStep step) {
        values.computeIfPresent(
                sessionId,
                (id, runtime) ->
                        new SessionRuntime(
                                runtime.planStatus(),
                                runtime.planProgress(),
                                step,
                                runtime.pausedSeconds()));
    }

    @Override
    public void clearAnalysisStep(long sessionId) {
        updateAnalysisStep(sessionId, null);
    }

    @Override
    public void clearAnalysis(long sessionId) {
        clearAnalysisStep(sessionId);
        analysisStartedAt.remove(sessionId);
        evaluateJobIds.remove(sessionId);
    }

    @Override
    public Optional<Instant> findAnalysisStartedAt(long sessionId) {
        return Optional.ofNullable(analysisStartedAt.get(sessionId));
    }

    @TestConfiguration
    public static class Config {
        @Bean
        @Primary
        public InMemorySessionRuntimeStore inMemorySessionRuntimeStore() {
            return new InMemorySessionRuntimeStore();
        }
    }
}
