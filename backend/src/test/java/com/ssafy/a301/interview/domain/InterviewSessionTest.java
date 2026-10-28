package com.ssafy.a301.interview.domain;

import static com.ssafy.a301.TestEntities.T0;
import static com.ssafy.a301.TestEntities.withId;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.User;
import org.junit.jupiter.api.Test;

/** 면접 상태 전이, 경과 시간, 점수 → 3단계 변환을 확인한다. */
class InterviewSessionTest {

    private final User user = withId(new User("a@ssafy.com", "hash", "면접왕"), 1);
    private final Application application =
            withId(new Application(user, "○○전자", "백엔드 개발자", "저는…"), 10);

    private InterviewSession session(InterviewMode mode) {
        return withId(new InterviewSession(user, application, Persona.DEVIL, mode), 55);
    }

    @Test
    void statusMovesThroughResultFlow() {
        InterviewSession s = session(InterviewMode.VIDEO);
        assertThat(s.getStatus()).isEqualTo(SessionStatus.READY);

        s.start(T0);
        assertThat(s.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
        assertThat(s.end(T0.plusMinutes(18), 2)).isTrue();
        assertThat(s.getStatus()).isEqualTo(SessionStatus.ANALYZING);
        s.failAnalysis();
        assertThat(s.getStatus()).isEqualTo(SessionStatus.FAILED);
        s.retryAnalysis();
        s.complete("총평", "다음에 해볼 것");
        assertThat(s.getStatus()).isEqualTo(SessionStatus.COMPLETED);
        assertThat(s.getHeadline()).isEqualTo("총평");
        assertThat(s.getSummary()).isEqualTo("다음에 해볼 것");
    }

    @Test
    void wrongStatusIsRejected() {
        InterviewSession s = session(InterviewMode.VIDEO);
        s.start(T0);
        assertThatThrownBy(() -> s.start(T0))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).errorCode())
                .isEqualTo(ErrorCode.INVALID_SESSION_STATE);
    }

    @Test
    void startFailedIsStartedAgainOnly() {
        InterviewSession s = session(InterviewMode.VIDEO);
        assertThatThrownBy(s::failStart).isInstanceOf(ApiException.class);

        s.start(T0);
        s.failStart();
        assertThat(s.getStatus()).isEqualTo(SessionStatus.START_FAILED);
        assertThat(s.canStart()).isTrue();
        assertThatThrownBy(() -> s.end(T0.plusMinutes(1), 0)).isInstanceOf(ApiException.class);

        s.start(T0.plusMinutes(1));
        assertThat(s.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
        assertThat(s.getStartedAt()).isEqualTo(T0.plusMinutes(1));
        assertThat(s.canStart()).isFalse();
    }

    @Test
    void endingWithoutAnswerIsAbortedAndNotPractice() {
        InterviewSession s = session(InterviewMode.CHAT);
        s.start(T0);
        assertThat(s.end(T0.plusSeconds(95), 0)).isFalse();
        assertThat(s.getStatus()).isEqualTo(SessionStatus.ABORTED);
    }

    @Test
    void elapsedSecondsExcludesPausedTime() {
        InterviewSession s = session(InterviewMode.VIDEO);
        SessionRuntime runtime = new SessionRuntime(PlanStatus.READY, null, null, 30);
        assertThat(runtime.elapsedSeconds(s, T0)).isZero();

        s.start(T0);
        assertThat(runtime.elapsedSeconds(s, T0.plusSeconds(552))).isEqualTo(522);
        s.end(T0.plusSeconds(600), 1);
        assertThat(runtime.elapsedSeconds(s, T0.plusSeconds(900))).isEqualTo(570);
    }

    @Test
    void gradeFollowsScoreBoundary() {
        assertThat(Grade.of(Grade.GOOD_MIN)).isEqualTo(Grade.GOOD);
        assertThat(Grade.of(Grade.GOOD_MIN - 1)).isEqualTo(Grade.NORMAL);
        assertThat(Grade.of(Grade.NORMAL_MIN - 1)).isEqualTo(Grade.WEAK);
        assertThat(Grade.ofNullable(null)).isNull();
    }
}
