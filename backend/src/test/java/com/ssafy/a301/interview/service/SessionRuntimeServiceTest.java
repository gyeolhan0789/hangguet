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
import org.junit.jupiter.api.Test;

class SessionRuntimeServiceTest {
    private static final Instant STARTED = Instant.parse("2026-10-15T03:00:00Z");
    private static final Instant WITHIN = STARTED.plus(Duration.ofMinutes(3));
    private static final Instant AFTER = WITHIN.plusSeconds(1);

    private final SessionRuntimeStore store = mock(SessionRuntimeStore.class);
    private final InterviewPlanRepository plans = mock(InterviewPlanRepository.class);
    private final SessionRuntimeService service =
            new SessionRuntimeService(store, plans, Duration.ofMinutes(3));

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
    void generatingWithoutStartTimeKeepsWaiting() {
        SessionRuntime generating = new SessionRuntime(PlanStatus.GENERATING, 0, null, 0);
        when(store.find(55L)).thenReturn(Optional.of(generating));
        when(store.findPlanStartedAt(55L)).thenReturn(Optional.empty());

        assertThat(service.current(55L, AFTER)).isEqualTo(generating);
    }
}
