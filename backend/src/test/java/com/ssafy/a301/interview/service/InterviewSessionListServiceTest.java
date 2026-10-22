package com.ssafy.a301.interview.service;

import static com.ssafy.a301.TestEntities.withId;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.SessionScoreRepository;
import com.ssafy.a301.user.domain.User;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

@ExtendWith(MockitoExtension.class)
class InterviewSessionListServiceTest {
    @Mock private InterviewSessionRepository sessions;
    @Mock private AnswerRepository answers;
    @Mock private SessionScoreRepository scores;

    @Test
    void mapsCompletedAndPendingRecordsWithWholeDateSummary() {
        OffsetDateTime start = OffsetDateTime.parse("2026-10-21T00:00:00+09:00");
        InterviewSession completed =
                session(11, SessionStatus.COMPLETED, start, start.plusSeconds(119));
        InterviewSession analyzing =
                session(
                        12,
                        SessionStatus.ANALYZING,
                        start.plusHours(1),
                        start.plusHours(1).plusSeconds(2));
        PageRequest pageable = PageRequest.of(0, 10);
        when(sessions.findPracticeSessions(eq(7L), any(), any(), any(), any()))
                .thenReturn(new PageImpl<>(List.of(analyzing, completed), pageable, 2));
        when(answers.countBySessionIds(List.of(12L, 11L)))
                .thenReturn(List.of(answerCount(12, 2), answerCount(11, 3)));
        when(scores.findBySessionIds(List.of(11L)))
                .thenReturn(
                        List.of(
                                new SessionScore(completed, Criterion.JOB_FIT, 80, null),
                                new SessionScore(completed, Criterion.COVER_LETTER, 65, null),
                                new SessionScore(completed, Criterion.LOGIC, 59, null),
                                new SessionScore(completed, Criterion.DELIVERY, 75, null)));
        when(sessions.countPracticeSessions(eq(7L), any())).thenReturn(9L);
        when(sessions.findPracticeDurations(eq(7L), any(), any(), any()))
                .thenReturn(
                        List.of(
                                new Object[] {start, start.plusSeconds(119)},
                                new Object[] {start, start.plusSeconds(2)}));

        var result =
                new InterviewSessionListService(sessions, answers, scores)
                        .list(7, LocalDate.of(2026, 10, 21), 0, 10);

        assertThat(result.content()).hasSize(2);
        assertThat(result.content().get(0).answeredCount()).isEqualTo(2);
        assertThat(result.content().get(0).summary()).isNull();
        assertThat(result.content().get(0).criterionGrades()).isEmpty();
        assertThat(result.content().get(1).summary()).isEqualTo("총평");
        assertThat(result.content().get(1).criterionGrades())
                .extracting(grade -> grade.criterion() + ":" + grade.grade())
                .containsExactly(
                        "JOB_FIT:GOOD", "COVER_LETTER:NORMAL", "LOGIC:WEAK", "DELIVERY:NORMAL");
        assertThat(result.summary().totalInterviewCount()).isEqualTo(9);
        assertThat(result.summary().practiceMinutes()).isEqualTo(2);

        ArgumentCaptor<OffsetDateTime> from = ArgumentCaptor.forClass(OffsetDateTime.class);
        ArgumentCaptor<OffsetDateTime> to = ArgumentCaptor.forClass(OffsetDateTime.class);
        ArgumentCaptor<Pageable> requestedPage = ArgumentCaptor.forClass(Pageable.class);
        verify(sessions)
                .findPracticeSessions(
                        eq(7L), any(), from.capture(), to.capture(), requestedPage.capture());
        assertThat(from.getValue()).isEqualTo("2026-10-21T00:00+09:00");
        assertThat(to.getValue()).isEqualTo("2026-10-22T00:00+09:00");
        assertThat(requestedPage.getValue().getSort().toString())
                .isEqualTo("startedAt: DESC,id: DESC");
    }

    @Test
    void emptyPageSkipsPageDetailQueriesButKeepsSummary() {
        PageRequest pageable = PageRequest.of(2, 10);
        when(sessions.findPracticeSessions(eq(7L), any(), any(), any(), any()))
                .thenReturn(new PageImpl<>(List.of(), pageable, 0));
        when(sessions.countPracticeSessions(eq(7L), any())).thenReturn(4L);
        when(sessions.findPracticeDurations(eq(7L), any(), any(), any())).thenReturn(List.of());

        var result =
                new InterviewSessionListService(sessions, answers, scores)
                        .list(7, LocalDate.of(2026, 10, 21), 2, 10);

        assertThat(result.content()).isEmpty();
        assertThat(result.page().number()).isEqualTo(2);
        assertThat(result.summary().totalInterviewCount()).isEqualTo(4);
        assertThat(result.summary().practiceMinutes()).isZero();
        verify(answers, never()).countBySessionIds(any());
        verify(scores, never()).findBySessionIds(any());
    }

    @Test
    void pageBeyondJpaOffsetLimitReturnsEmptyPageWithDailySummary() {
        OffsetDateTime start = OffsetDateTime.parse("2026-10-21T20:00:00+09:00");
        when(sessions.findPracticeDurations(eq(7L), any(), any(), any()))
                .thenReturn(List.<Object[]>of(new Object[] {start, start.plusMinutes(18)}));
        when(sessions.countPracticeSessions(eq(7L), any())).thenReturn(4L);

        var result =
                new InterviewSessionListService(sessions, answers, scores)
                        .list(7, LocalDate.of(2026, 10, 21), Integer.MAX_VALUE, 20);

        assertThat(result.content()).isEmpty();
        assertThat(result.page().number()).isEqualTo(Integer.MAX_VALUE);
        assertThat(result.page().totalElements()).isEqualTo(1);
        assertThat(result.page().totalPages()).isEqualTo(1);
        assertThat(result.summary().totalInterviewCount()).isEqualTo(4);
        assertThat(result.summary().practiceMinutes()).isEqualTo(18);
        verify(sessions, never()).findPracticeSessions(anyLong(), any(), any(), any(), any());
        verify(answers, never()).countBySessionIds(any());
        verify(scores, never()).findBySessionIds(any());
    }

    @Test
    void rejectsCompletedResultWithMissingCriteria() {
        OffsetDateTime start = OffsetDateTime.parse("2026-10-21T20:00:00+09:00");
        InterviewSession completed =
                session(11, SessionStatus.COMPLETED, start, start.plusMinutes(10));
        when(sessions.findPracticeSessions(eq(7L), any(), any(), any(), any()))
                .thenReturn(new PageImpl<>(List.of(completed), PageRequest.of(0, 10), 1));
        when(sessions.findPracticeDurations(eq(7L), any(), any(), any())).thenReturn(List.of());
        when(answers.countBySessionIds(List.of(11L))).thenReturn(List.of(answerCount(11, 1)));
        when(scores.findBySessionIds(List.of(11L)))
                .thenReturn(List.of(new SessionScore(completed, Criterion.LOGIC, 80, null)));

        assertThatThrownBy(
                        () ->
                                new InterviewSessionListService(sessions, answers, scores)
                                        .list(7, LocalDate.of(2026, 10, 21), 0, 10))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        error -> assertThat(error.errorCode()).isEqualTo(ErrorCode.INTERNAL_ERROR));
    }

    private static InterviewSession session(
            long id, SessionStatus status, OffsetDateTime startedAt, OffsetDateTime endedAt) {
        User user = withId(new User("test@example.com", "hash", "사용자"), 7);
        Application application = withId(new Application(user, "회사", "직무", "자소서"), 3);
        InterviewSession session =
                withId(
                        new InterviewSession(user, application, Persona.DEVIL, InterviewMode.VIDEO),
                        id);
        session.start(startedAt);
        session.end(endedAt, 1);
        if (status == SessionStatus.COMPLETED) {
            session.complete("총평");
        } else if (status == SessionStatus.FAILED) {
            session.failAnalysis();
        }
        return session;
    }

    private static AnswerRepository.SessionAnswerCount answerCount(long sessionId, long count) {
        return new AnswerRepository.SessionAnswerCount() {
            @Override
            public Long getSessionId() {
                return sessionId;
            }

            @Override
            public long getAnsweredCount() {
                return count;
            }
        };
    }
}
