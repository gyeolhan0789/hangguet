package com.ssafy.a301.interview.service;

import static com.ssafy.a301.TestEntities.T0;
import static com.ssafy.a301.TestEntities.withId;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.dto.InterviewDtos.SttTokenResponse;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.stt.SonioxClient;
import com.ssafy.a301.user.domain.User;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class SttTokenServiceTest {

    private final InterviewSessionRepository sessions = mock(InterviewSessionRepository.class);
    private final SonioxClient soniox = mock(SonioxClient.class);
    private final SttTokenService service = new SttTokenService(sessions, soniox);

    private final User user = withId(new User("a@ssafy.com", "hash", "면접왕"), 1);
    private final Application application =
            withId(new Application(user, "○○전자", "백엔드 개발자", "저는…"), 10);

    @Test
    void issuesKeyForVideoInterviewInProgress() {
        InterviewSession session = session(InterviewMode.VIDEO);
        session.start(T0);
        when(sessions.findByIdAndUserId(55L, 1L)).thenReturn(Optional.of(session));
        when(soniox.issueTemporaryKey("session-55"))
                .thenReturn(new SttTokenResponse("temp-key", T0.plusMinutes(5)));

        var response = service.issue(1, 55);

        assertThat(response.token()).isEqualTo("temp-key");
        assertThat(response.expiresAt()).isEqualTo(T0.plusMinutes(5));
    }

    @Test
    void otherUsersInterviewIsNotFound() {
        when(sessions.findByIdAndUserId(55L, 2L)).thenReturn(Optional.empty());

        assertCode(() -> service.issue(2, 55), ErrorCode.SESSION_NOT_FOUND);
    }

    @Test
    void interviewNotStartedIsInvalidState() {
        when(sessions.findByIdAndUserId(55L, 1L))
                .thenReturn(Optional.of(session(InterviewMode.VIDEO)));

        assertCode(() -> service.issue(1, 55), ErrorCode.INVALID_SESSION_STATE);
    }

    @Test
    void chatInterviewIsInvalidState() {
        InterviewSession session = session(InterviewMode.CHAT);
        session.start(T0);
        when(sessions.findByIdAndUserId(55L, 1L)).thenReturn(Optional.of(session));

        assertCode(() -> service.issue(1, 55), ErrorCode.INVALID_SESSION_STATE);
    }

    private InterviewSession session(InterviewMode mode) {
        return withId(new InterviewSession(user, application, Persona.DEVIL, mode), 55);
    }

    private void assertCode(Runnable call, ErrorCode code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
        verify(soniox, never()).issueTemporaryKey(any());
    }
}
