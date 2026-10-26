package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.SessionRuntimeStore;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class SessionRuntimeServiceTest {
    private static final Instant STARTED = Instant.parse("2026-10-15T03:00:00Z");
    private static final Instant WITHIN = STARTED.plus(Duration.ofMinutes(3));
    private static final Instant AFTER = WITHIN.plusSeconds(1);

    private final SessionRuntimeStore store = mock(SessionRuntimeStore.class);
    private final InterviewPlanRepository plans = mock(InterviewPlanRepository.class);
    private final SessionRuntimeService service =
            new SessionRuntimeService(store, plans, Duration.ofMinutes(3), Duration.ofMinutes(10));

    @Test
    void storedPlanStatusIsUsedAsIs() {
        SessionRuntime stored = new SessionRuntime(PlanStatus.READY, null, null, 0);
        when(store.find(55L)).thenReturn(Optional.of(stored));

        assertThat(service.current(55L, AFTER)).isEqualTo(stored);
        verify(plans, never()).existsById(55L);
    }

    @Test
    void missingStatusWithPlanIsReady() {
        when(store.find(55L)).thenReturn(Optional.empty());
        when(plans.existsById(55L)).thenReturn(true);

        assertThat(service.current(55L, AFTER))
                .isEqualTo(new SessionRuntime(PlanStatus.READY, null, null, 0));
    }

    @Test
    void missingStatusWithoutPlanIsFailed() {
        when(store.find(55L)).thenReturn(Optional.empty());
        when(plans.existsById(55L)).thenReturn(false);

        assertThat(service.current(55L, AFTER))
                .isEqualTo(new SessionRuntime(PlanStatus.FAILED, null, null, 0));
    }

    @Test
    void otherFieldsAreKeptWhenOnlyPlanStatusIsMissing() {
        when(store.find(55L))
                .thenReturn(Optional.of(new SessionRuntime(null, null, AnalysisStep.SCORING, 30)));
        when(plans.existsById(55L)).thenReturn(true);

        assertThat(service.current(55L, AFTER))
                .isEqualTo(new SessionRuntime(PlanStatus.READY, null, AnalysisStep.SCORING, 30));
    }

    @Test
    void generatingWithinTimeoutKeepsWaiting() {
        SessionRuntime generating = new SessionRuntime(PlanStatus.GENERATING, 50, null, 0);
        when(store.find(55L)).thenReturn(Optional.of(generating));
        when(store.findPlanStartedAt(55L)).thenReturn(Optional.of(STARTED));

        assertThat(service.current(55L, WITHIN)).isEqualTo(generating);
        verify(store, never()).failPlanIfGenerating(55L);
    }

    @Test
    void generatingPastTimeoutFails() {
        when(store.find(55L))
                .thenReturn(Optional.of(new SessionRuntime(PlanStatus.GENERATING, 50, null, 0)));
        when(store.findPlanStartedAt(55L)).thenReturn(Optional.of(STARTED));

        assertThat(service.current(55L, AFTER))
                .isEqualTo(new SessionRuntime(PlanStatus.FAILED, null, null, 0));
        verify(store).failPlanIfGenerating(55L);
    }

    @Test
    void generatingPastTimeoutWithSavedPlanIsReady() {
        when(store.find(55L))
                .thenReturn(Optional.of(new SessionRuntime(PlanStatus.GENERATING, 100, null, 0)));
        when(store.findPlanStartedAt(55L)).thenReturn(Optional.of(STARTED));
        when(plans.existsById(55L)).thenReturn(true);

        assertThat(service.current(55L, AFTER))
                .isEqualTo(new SessionRuntime(PlanStatus.READY, null, null, 0));
        verify(store, never()).failPlanIfGenerating(55L);
    }

    @Test
    void analysisTimesOutAfterTenMinutes() {
        when(store.findAnalysisStartedAt(55L)).thenReturn(Optional.of(STARTED));

        assertThat(service.isAnalysisTimedOut(55L, null, STARTED.plus(Duration.ofMinutes(10))))
                .isFalse();
        assertThat(
                        service.isAnalysisTimedOut(
                                55L, null, STARTED.plus(Duration.ofMinutes(10)).plusSeconds(1)))
                .isTrue();
    }

    @Test
    void analysisStartTimeInRedisWinsOverEndedAt() {
        // 5.9로 다시 시작했으면 Redis의 시작 시각이 면접 종료 시각보다 늦다
        when(store.findAnalysisStartedAt(55L)).thenReturn(Optional.of(AFTER));

        assertThat(service.isAnalysisTimedOut(55L, STARTED, AFTER.plus(Duration.ofMinutes(5))))
                .isFalse();
    }

    @Test
    void lostAnalysisStartTimeFallsBackToEndedAt() {
        // Redis 상태가 TTL 만료·재시작으로 사라졌다. 종료 시각으로 판단해 ANALYZING에 계속 남지 않게 한다
        when(store.findAnalysisStartedAt(55L)).thenReturn(Optional.empty());

        assertThat(service.isAnalysisTimedOut(55L, STARTED, STARTED.plus(Duration.ofMinutes(10))))
                .isFalse();
        assertThat(service.isAnalysisTimedOut(55L, STARTED, AFTER.plus(Duration.ofDays(1))))
                .isTrue();
    }

    @Test
    void analysisWithoutAnyStartTimeKeepsWaiting() {
        when(store.findAnalysisStartedAt(55L)).thenReturn(Optional.empty());

        assertThat(service.isAnalysisTimedOut(55L, null, AFTER.plus(Duration.ofDays(1)))).isFalse();
    }

    @Test
    void generatingWithoutStartTimeKeepsWaiting() {
        SessionRuntime generating = new SessionRuntime(PlanStatus.GENERATING, 0, null, 0);
        when(store.find(55L)).thenReturn(Optional.of(generating));
        when(store.findPlanStartedAt(55L)).thenReturn(Optional.empty());

        assertThat(service.current(55L, AFTER)).isEqualTo(generating);
    }

    @Test
    void rolledBackPlanStartLeavesPlanFailedInsteadOfGenerating() {
        inTransaction(
                () -> service.startPlan(55L, STARTED),
                TransactionSynchronization.STATUS_ROLLED_BACK);

        verify(store).startPlan(55L, STARTED);
        verify(store).failPlanIfGenerating(55L);
    }

    @Test
    void rolledBackAnalysisStartClearsStartTimeAndJob() {
        UUID job = UUID.randomUUID();
        inTransaction(
                () -> service.startAnalysis(55L, STARTED, job),
                TransactionSynchronization.STATUS_ROLLED_BACK);

        verify(store).startAnalysis(55L, STARTED, job);
        verify(store).clearAnalysis(55L);
    }

    @Test
    void committedStartsAreKept() {
        inTransaction(
                () -> {
                    service.startPlan(55L, STARTED);
                    service.startAnalysis(55L, STARTED, UUID.randomUUID());
                },
                TransactionSynchronization.STATUS_COMMITTED);

        verify(store, never()).failPlanIfGenerating(55L);
        verify(store, never()).clearAnalysis(55L);
    }

    // 트랜잭션 안에서 부르고 주어진 결과로 끝낸 것처럼 등록된 후처리를 실행한다
    private static void inTransaction(Runnable work, int status) {
        TransactionSynchronizationManager.initSynchronization();
        try {
            work.run();
            for (TransactionSynchronization sync :
                    TransactionSynchronizationManager.getSynchronizations()) {
                sync.afterCompletion(status);
            }
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }
}
