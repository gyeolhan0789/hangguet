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
import java.util.Optional;
import org.junit.jupiter.api.Test;

class SessionRuntimeServiceTest {
    private final SessionRuntimeStore store = mock(SessionRuntimeStore.class);
    private final InterviewPlanRepository plans = mock(InterviewPlanRepository.class);
    private final SessionRuntimeService service = new SessionRuntimeService(store, plans);

    @Test
    void storedPlanStatusIsUsedAsIs() {
        SessionRuntime stored = new SessionRuntime(PlanStatus.GENERATING, 50, null, 0);
        when(store.find(55L)).thenReturn(Optional.of(stored));

        assertThat(service.current(55L)).isEqualTo(stored);
        verify(plans, never()).existsById(55L);
    }

    @Test
    void missingStatusWithPlanIsReady() {
        when(store.find(55L)).thenReturn(Optional.empty());
        when(plans.existsById(55L)).thenReturn(true);

        assertThat(service.current(55L))
                .isEqualTo(new SessionRuntime(PlanStatus.READY, null, null, 0));
    }

    @Test
    void missingStatusWithoutPlanIsFailed() {
        when(store.find(55L)).thenReturn(Optional.empty());
        when(plans.existsById(55L)).thenReturn(false);

        assertThat(service.current(55L))
                .isEqualTo(new SessionRuntime(PlanStatus.FAILED, null, null, 0));
    }

    @Test
    void otherFieldsAreKeptWhenOnlyPlanStatusIsMissing() {
        when(store.find(55L))
                .thenReturn(Optional.of(new SessionRuntime(null, null, AnalysisStep.SCORING, 30)));
        when(plans.existsById(55L)).thenReturn(true);

        assertThat(service.current(55L))
                .isEqualTo(new SessionRuntime(PlanStatus.READY, null, AnalysisStep.SCORING, 30));
    }
}
