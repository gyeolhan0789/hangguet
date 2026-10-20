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
import com.ssafy.a301.interview.dto.InterviewDtos.TtsTokenResponse;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.tts.ElevenLabsClient;
import com.ssafy.a301.user.domain.User;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class TtsTokenServiceTest {

    private final InterviewSessionRepository sessions = mock(InterviewSessionRepository.class);
    private final InterviewQuestionRepository questions = mock(InterviewQuestionRepository.class);
    private final ElevenLabsClient elevenLabs = mock(ElevenLabsClient.class);
    private final TtsTokenService service = new TtsTokenService(sessions, questions, elevenLabs);

    private final User user = withId(new User("a@ssafy.com", "hash", "면접왕"), 1);
    private final Application application =
            withId(new Application(user, "○○전자", "백엔드 개발자", "저는…"), 10);

    @Test
    void issuesTokenForPersonaOfInterviewInProgress() {
        InterviewSession session = session(Persona.COFFEE_CHAT);
        session.start(T0);
        when(sessions.findByIdAndUserId(55L, 1L)).thenReturn(Optional.of(session));
        when(questions.existsByIdAndSessionId(303L, 55L)).thenReturn(true);
        TtsTokenResponse token =
                new TtsTokenResponse("tts-token", T0.plusMinutes(15), "voice", "model");
        when(elevenLabs.issueToken(Persona.COFFEE_CHAT)).thenReturn(token);

        assertThat(service.issue(1, 55, 303)).isEqualTo(token);
    }

    @Test
    void otherUsersInterviewIsNotFound() {
        when(sessions.findByIdAndUserId(55L, 2L)).thenReturn(Optional.empty());

        assertCode(() -> service.issue(2, 55, 303), ErrorCode.SESSION_NOT_FOUND);
    }

    @Test
    void questionOfOtherInterviewIsNotFound() {
        InterviewSession session = session(Persona.DEVIL);
        session.start(T0);
        when(sessions.findByIdAndUserId(55L, 1L)).thenReturn(Optional.of(session));
        when(questions.existsByIdAndSessionId(303L, 55L)).thenReturn(false);

        assertCode(() -> service.issue(1, 55, 303), ErrorCode.QUESTION_NOT_FOUND);
    }

    @Test
    void interviewNotInProgressIsInvalidState() {
        when(sessions.findByIdAndUserId(55L, 1L)).thenReturn(Optional.of(session(Persona.DEVIL)));
        when(questions.existsByIdAndSessionId(303L, 55L)).thenReturn(true);

        assertCode(() -> service.issue(1, 55, 303), ErrorCode.INVALID_SESSION_STATE);
    }

    private InterviewSession session(Persona persona) {
        return withId(new InterviewSession(user, application, persona, InterviewMode.CHAT), 55);
    }

    private void assertCode(Runnable call, ErrorCode code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.errorCode()).isEqualTo(code));
        verify(elevenLabs, never()).issueToken(any());
    }
}
