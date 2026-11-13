package com.ssafy.a301.interview.service;

import static com.ssafy.a301.TestEntities.withId;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.repository.ApplicationClaimRepository;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.company.service.CompanyCardFinder;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import com.ssafy.a301.group.service.GroupEndService;
import com.ssafy.a301.group.service.GroupTurnService;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.RecordingRepository;
import com.ssafy.a301.interview.repository.SpeechMetricRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.practice.repository.PracticeLogRepository;
import com.ssafy.a301.practice.service.PracticeService;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionCallback;
import org.springframework.transaction.support.TransactionTemplate;

@ExtendWith(MockitoExtension.class)
class InterviewSessionPracticeDateTest {
    private static final OffsetDateTime END = OffsetDateTime.parse("2026-10-22T00:10:00+09:00");
    private static final LocalDate START_DATE = LocalDate.of(2026, 10, 21);

    @Mock private InterviewSessionRepository sessions;
    @Mock private InterviewQuestionRepository questions;
    @Mock private AnswerRepository answers;
    @Mock private InterviewPlanRepository plans;
    @Mock private ApplicationRepository applications;
    @Mock private ApplicationClaimRepository applicationClaims;
    @Mock private UserRepository users;
    @Mock private PracticeLogRepository practiceLogs;
    @Mock private SessionRuntimeService runtimes;
    @Mock private AiJobService aiJobs;
    @Mock private TransactionTemplate transactions;
    @Mock private InterviewRoom rooms;
    @Mock private RecordingRepository recordings;
    @Mock private SpeechMetricRepository speechMetrics;
    @Mock private CompanyCardFinder companyCards;
    @Mock private InterviewCapacity capacity;
    @Mock private GroupEndService groupEnds;
    @Mock private GroupTurnService groupTurns;
    @Mock private InterviewGroupRepository groups;
    @Mock private QuestionPoolAssigner pools;
    private InterviewSessionService service;

    @BeforeEach
    void setup() {
        // 연습 기록·레벨업 계산은 실제 PracticeService로 확인한다
        SessionEnder ender =
                new SessionEnder(
                        answers,
                        new PracticeService(practiceLogs),
                        runtimes,
                        aiJobs,
                        recordings,
                        speechMetrics);
        service =
                new InterviewSessionService(
                        sessions,
                        questions,
                        answers,
                        plans,
                        applications,
                        users,
                        runtimes,
                        aiJobs,
                        transactions,
                        rooms,
                        companyCards,
                        capacity,
                        ender,
                        groupEnds,
                        groupTurns,
                        groups,
                        applicationClaims,
                        pools);
        when(transactions.execute(any()))
                .thenAnswer(
                        invocation -> {
                            TransactionCallback<?> callback = invocation.getArgument(0);
                            return callback.doInTransaction(mock(TransactionStatus.class));
                        });
        when(runtimes.current(anyLong(), any()))
                .thenReturn(new SessionRuntime(PlanStatus.READY, null, null, 0));
        // 결과 생성 시작 때 Outbox에 넣은 작업의 jobId를 기록한다
        lenient().when(aiJobs.enqueue(any())).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    void overnightInterviewRecordsKoreaStartDateAndUpdatesCurrentStreak() {
        session(OffsetDateTime.parse("2026-10-21T14:50:00Z"), 1);
        when(practiceLogs.findPracticeDatesByUserId(1))
                .thenReturn(List.of(START_DATE.minusDays(2), START_DATE.minusDays(1)));
        when(practiceLogs.insertIfAbsent(1, START_DATE)).thenReturn(1);

        try (var time = mockStatic(OffsetDateTime.class, CALLS_REAL_METHODS)) {
            time.when(() -> OffsetDateTime.now(KoreaTime.ZONE)).thenReturn(END);
            var result = service.end(1, 55, null);
            assertThat(result.leveledUp()).isTrue();
            assertThat(result.endedAt()).isEqualTo(END);
        }
        verify(practiceLogs).insertIfAbsent(1, START_DATE);
        verify(practiceLogs, never()).insertIfAbsent(1, START_DATE.plusDays(1));
    }

    @Test
    void sameStartDateAlreadyRecordedDoesNotLevelUpAgain() {
        session(END.minusHours(1), 1);
        when(practiceLogs.findPracticeDatesByUserId(1)).thenReturn(List.of(START_DATE));
        when(practiceLogs.insertIfAbsent(1, START_DATE)).thenReturn(0);
        try (var time = mockStatic(OffsetDateTime.class, CALLS_REAL_METHODS)) {
            time.when(() -> OffsetDateTime.now(KoreaTime.ZONE)).thenReturn(END);
            assertThat(service.end(1, 55, null).leveledUp()).isFalse();
        }
    }

    @Test
    void oldStartDateDoesNotGrantAnExpiredStreakBadge() {
        LocalDate oldDate = START_DATE.minusDays(2);
        session(END.minusDays(3), 1);
        when(practiceLogs.findPracticeDatesByUserId(1))
                .thenReturn(List.of(oldDate.minusDays(2), oldDate.minusDays(1)));
        when(practiceLogs.insertIfAbsent(1, oldDate)).thenReturn(1);
        try (var time = mockStatic(OffsetDateTime.class, CALLS_REAL_METHODS)) {
            time.when(() -> OffsetDateTime.now(KoreaTime.ZONE)).thenReturn(END);
            assertThat(service.end(1, 55, null).leveledUp()).isFalse();
        }
        verify(practiceLogs).insertIfAbsent(1, oldDate);
    }

    @Test
    void interviewWithoutAnswersDoesNotRecordAnyPracticeDate() {
        session(END.minusHours(1), 0);
        try (var time = mockStatic(OffsetDateTime.class, CALLS_REAL_METHODS)) {
            time.when(() -> OffsetDateTime.now(KoreaTime.ZONE)).thenReturn(END);
            assertThat(service.end(1, 55, null).leveledUp()).isFalse();
        }
        verify(practiceLogs, never()).insertIfAbsent(anyLong(), any());
    }

    private void session(OffsetDateTime start, int answerCount) {
        User user = withId(new User("practice@example.com", "hash", "면접자"), 1);
        Application application = withId(new Application(user, "회사", "직무"), 10);
        InterviewSession session =
                withId(
                        new InterviewSession(user, application, Persona.DEVIL, InterviewMode.CHAT),
                        55);
        session.start(start);
        when(sessions.findByIdAndUserId(55L, 1L)).thenReturn(Optional.of(session));
        when(sessions.findForUpdate(55, 1)).thenReturn(Optional.of(session));
        when(answers.countByQuestionSessionId(55L)).thenReturn(answerCount);
    }
}
