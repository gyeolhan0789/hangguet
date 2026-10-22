package com.ssafy.a301.interview.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

/** 실행 중인 Redis에서 AI 작업자가 쓰는 방식(HSET·HDEL)과 섞여도 서로의 필드를 덮어쓰지 않는지 확인한다. 만든 키만 지운다. */
@Tag("redis-integration")
class RedisSessionRuntimeStoreIntegrationTest {
    private static final long SESSION_ID = Long.MAX_VALUE;
    private static final String KEY = "session:" + SESSION_ID + ":runtime";

    private LettuceConnectionFactory connection;
    private StringRedisTemplate redis;
    private RedisSessionRuntimeStore store;

    @BeforeEach
    void setUp() {
        connection =
                new LettuceConnectionFactory(
                        System.getenv().getOrDefault("REDIS_HOST", "localhost"),
                        Integer.parseInt(System.getenv().getOrDefault("REDIS_PORT", "6379")));
        connection.afterPropertiesSet();
        connection.start();
        redis = new StringRedisTemplate(connection);
        store = new RedisSessionRuntimeStore(redis);
    }

    @AfterEach
    void tearDown() {
        redis.delete(KEY);
        connection.destroy();
    }

    @Test
    void workerAndBeFieldsDoNotOverwriteEachOther() {
        store.startPlan(SESSION_ID, Instant.ofEpochMilli(1_000L));
        assertThat(store.find(SESSION_ID))
                .contains(new SessionRuntime(PlanStatus.GENERATING, 0, null, 0));
        assertThat(redis.getExpire(KEY)).isGreaterThan(23 * 60 * 60L);

        // 작업자: 플랜 완료
        redis.opsForHash().put(KEY, "planStatus", "READY");
        redis.opsForHash().delete(KEY, "planProgress");
        // BE: 결과 생성 시작
        store.startAnalysis(SESSION_ID);
        // 작업자: 단계 갱신
        redis.opsForHash().put(KEY, "analysisStep", "SCORING");

        assertThat(store.find(SESSION_ID))
                .contains(new SessionRuntime(PlanStatus.READY, null, AnalysisStep.SCORING, 0));
    }

    @Test
    void retryPlanResetsOnlyPlanFields() {
        redis.opsForHash().put(KEY, "planStatus", "FAILED");
        redis.opsForHash().put(KEY, "pausedSeconds", "12");

        store.startPlan(SESSION_ID, Instant.ofEpochMilli(1_000L));

        assertThat(store.find(SESSION_ID))
                .contains(new SessionRuntime(PlanStatus.GENERATING, 0, null, 12));
    }

    @Test
    void timeoutFailsOnlyStillGeneratingPlan() {
        store.startPlan(SESSION_ID, Instant.ofEpochMilli(1_000L));
        assertThat(store.findPlanStartedAt(SESSION_ID)).contains(Instant.ofEpochMilli(1_000L));

        store.failPlanIfGenerating(SESSION_ID);
        assertThat(store.find(SESSION_ID))
                .contains(new SessionRuntime(PlanStatus.FAILED, null, null, 0));

        // 작업자가 먼저 READY로 바꿨으면 그대로 둔다
        redis.opsForHash().put(KEY, "planStatus", "READY");
        store.failPlanIfGenerating(SESSION_ID);
        assertThat(store.find(SESSION_ID))
                .contains(new SessionRuntime(PlanStatus.READY, null, null, 0));
    }
}
