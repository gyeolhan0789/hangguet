package com.ssafy.a301.interview.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

class RedisSessionRuntimeStoreTest {
    private static final String KEY = "session:55:runtime";
    private static final UUID JOB_ID = UUID.fromString("8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34");

    private final StringRedisTemplate redis = mock(StringRedisTemplate.class);

    @SuppressWarnings("unchecked")
    private final HashOperations<String, Object, Object> hashes = mock(HashOperations.class);

    private final RedisSessionRuntimeStore store = new RedisSessionRuntimeStore(redis);

    @BeforeEach
    void setUp() {
        when(redis.opsForHash()).thenReturn(hashes);
    }

    @Test
    void readsFieldsAndMissingFieldsAsEmpty() {
        when(hashes.entries(KEY))
                .thenReturn(
                        Map.of(
                                "planStatus", "READY",
                                "analysisStep", "SCORING",
                                "pausedSeconds", "30"));

        assertThat(store.find(55L))
                .contains(new SessionRuntime(PlanStatus.READY, null, AnalysisStep.SCORING, 30));
    }

    @Test
    void missingKeyIsEmpty() {
        when(hashes.entries(KEY)).thenReturn(Map.of());

        assertThat(store.find(55L)).isEmpty();
    }

    @Test
    void startPlanSetsOnlyPlanFieldsAndRefreshesTtl() {
        store.startPlan(55L, Instant.ofEpochMilli(1_000L));

        verify(hashes)
                .putAll(
                        KEY,
                        Map.of(
                                "planStatus", "GENERATING",
                                "planProgress", "0",
                                "planStartedAt", "1000"));
        verify(redis).expire(KEY, Duration.ofDays(1));
    }

    @Test
    void readsPlanStartedAt() {
        when(hashes.get(KEY, "planStartedAt")).thenReturn("1000");

        assertThat(store.findPlanStartedAt(55L)).contains(Instant.ofEpochMilli(1_000L));
    }

    @Test
    void planProgressAndReadyRefreshTtl() {
        store.updatePlanProgress(55L, 50);
        store.markPlanReady(55L);

        verify(hashes).put(KEY, "planProgress", "50");
        verify(hashes).put(KEY, "planStatus", "READY");
        verify(hashes).delete(KEY, "planProgress");
        verify(redis, times(2)).expire(KEY, Duration.ofDays(1));
    }

    @Test
    @SuppressWarnings("unchecked")
    void failPlanUsesConditionalScript() {
        store.failPlanIfGenerating(55L);

        verify(redis).execute(any(RedisScript.class), eq(List.of(KEY)));
    }

    @Test
    void startAnalysisSetsOnlyAnalysisFieldsAndRefreshesTtl() {
        store.startAnalysis(55L, Instant.ofEpochMilli(2_000L), JOB_ID);

        verify(hashes)
                .putAll(
                        KEY,
                        Map.of(
                                "analysisStep",
                                "ORGANIZING_ANSWERS",
                                "analysisStartedAt",
                                "2000",
                                "evaluateJobId",
                                JOB_ID.toString()));
        verify(redis).expire(KEY, Duration.ofDays(1));
    }

    @Test
    void readsEvaluateJobId() {
        when(hashes.get(KEY, "evaluateJobId")).thenReturn(JOB_ID.toString());

        assertThat(store.findEvaluateJobId(55L)).contains(JOB_ID);
    }

    @Test
    void updatesAndClearsAnalysisStep() {
        store.updateAnalysisStep(55L, AnalysisStep.SCORING);
        verify(hashes).put(KEY, "analysisStep", "SCORING");
        verify(redis).expire(KEY, Duration.ofDays(1));

        store.clearAnalysisStep(55L);
        verify(hashes).delete(KEY, "analysisStep");
    }

    @Test
    void readsAnalysisStartedAt() {
        when(hashes.get(KEY, "analysisStartedAt")).thenReturn("2000");

        assertThat(store.findAnalysisStartedAt(55L)).contains(Instant.ofEpochMilli(2_000L));
    }
}
