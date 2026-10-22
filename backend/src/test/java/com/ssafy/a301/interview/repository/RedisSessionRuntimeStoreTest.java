package com.ssafy.a301.interview.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;

class RedisSessionRuntimeStoreTest {
    private static final String KEY = "session:55:runtime";

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
    @SuppressWarnings("unchecked")
    void failPlanUsesConditionalScript() {
        store.failPlanIfGenerating(55L);

        verify(redis).execute(any(RedisScript.class), eq(List.of(KEY)));
    }

    @Test
    void startAnalysisSetsOnlyAnalysisStepAndRefreshesTtl() {
        store.startAnalysis(55L);

        verify(hashes).put(KEY, "analysisStep", "ORGANIZING_ANSWERS");
        verify(redis).expire(KEY, Duration.ofDays(1));
    }
}
