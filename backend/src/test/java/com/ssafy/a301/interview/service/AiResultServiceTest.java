package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.interview.InMemorySessionRuntimeStore;
import com.ssafy.a301.interview.domain.AiJobType;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.AnswerSpeech;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanClaim;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.AiJobRepository;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.service.AiResultService.Outcome;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

/** 실제 PostgreSQL로 결과 메시지 종류별 저장과 버림 조건(상태·중복)을 확인한다. Redis 진행 상태는 메모리 저장소다. */
@SpringBootTest
@Transactional
@Import(InMemorySessionRuntimeStore.Config.class)
class AiResultServiceTest {
    private static final OffsetDateTime STARTED_AT =
            OffsetDateTime.parse("2026-10-15T12:01:00+09:00");

    @Autowired private AiResultService results;
    @Autowired private InMemorySessionRuntimeStore runtimes;
    @Autowired private InterviewPlanRepository plans;
    @Autowired private InterviewQuestionRepository questions;
    @Autowired private AnswerRepository answers;
    @Autowired private AiJobRepository jobs;
    @Autowired private EntityManager em;
    @MockitoBean private AiJobQueue queue;
    @MockitoBean private InterviewRoom rooms;

    @BeforeEach
    void setUp() {
        runtimes.clear();
    }

    @Test
    void planProgressIsKeptOnlyWhileGenerating() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());

        assertThat(results.handle(planProgress(session, 50))).isEqualTo(Outcome.SAVED);
        assertThat(runtimes.find(session.getId()).orElseThrow().planProgress()).isEqualTo(50);

        runtimes.markPlanReady(session.getId());
        assertThat(results.handle(planProgress(session, 80))).isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void planCompletedIsSavedOnceAndMakesPlanReady() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());

        assertThat(results.handle(planCompleted(session, 5))).isEqualTo(Outcome.SAVED);
        InterviewPlan plan = plans.findById(session.getId()).orElseThrow();
        assertThat(plan.getQuestions()).hasSize(5);
        assertThat(plan.getClaims()).extracting(PlanClaim::id).containsExactly("c1");
        assertThat(plan.getModelVersion()).isEqualTo("gms-test");
        assertThat(runtimes.find(session.getId()).orElseThrow().planStatus())
                .isEqualTo(PlanStatus.READY);

        // 같은 결과가 다시 오면 버린다
        assertThat(results.handle(planCompleted(session, 5))).isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void planCompletedAfterSavedPlanOnlyMarksReady() {
        // 지난번에 플랜을 저장했지만 READY를 남기지 못하고 다시 처리한다
        InterviewSession session = newSession(InterviewMode.CHAT);
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());
        savePlan(session);

        assertThat(results.handle(planCompleted(session, 5))).isEqualTo(Outcome.DISCARDED);
        assertThat(runtimes.find(session.getId()).orElseThrow().planStatus())
                .isEqualTo(PlanStatus.READY);
        assertThat(plans.findById(session.getId()).orElseThrow().getPromptVersion())
                .isEqualTo("plan-v1");
    }

    @Test
    void planCompletedAfterFailureOrWithWrongQuestionsIsNotSaved() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());

        assertThatThrownBy(() -> results.handle(planCompleted(session, 4)))
                .isInstanceOf(InvalidAiResultException.class);
        // 질문 글이 비면 저장해도 질문을 낼 수 없다
        assertThatThrownBy(
                        () ->
                                results.handle(
                                        planCompleted(session, 5)
                                                .replace(
                                                        "\"content\":\"질문3\"",
                                                        "\"content\":\" \"")))
                .isInstanceOf(InvalidAiResultException.class);
        assertThat(plans.existsById(session.getId())).isFalse();

        assertThat(results.handle(planFailed(session))).isEqualTo(Outcome.SAVED);
        assertThat(runtimes.find(session.getId()).orElseThrow().planStatus())
                .isEqualTo(PlanStatus.FAILED);
        // 실패한 뒤 늦게 온 완료 결과는 버린다(5.3으로 다시 만든다)
        assertThat(results.handle(planCompleted(session, 5))).isEqualTo(Outcome.DISCARDED);
        assertThat(plans.existsById(session.getId())).isFalse();
    }

    @Test
    void questionStartedCreatesQuestionAtStartedTimeOnce() {
        InterviewSession session = startedSession(InterviewMode.CHAT);

        assertThat(results.handle(questionStarted(session, 2))).isEqualTo(Outcome.SAVED);
        InterviewQuestion question =
                questions.findBySessionIdAndSeq(session.getId(), 2).orElseThrow();
        assertThat(question.getContent()).isEqualTo("질문2");
        assertThat(question.getCreatedAt()).isEqualTo(STARTED_AT);

        assertThat(results.handle(questionStarted(session, 2))).isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void questionStartedBeforeStartIsDiscarded() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        savePlan(session);

        assertThat(results.handle(questionStarted(session, 1))).isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void videoAnswerIsSavedOnceAndScoringIsQueued() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);
        results.handle(questionStarted(session, 1));

        assertThat(results.handle(answerCompleted(session, 1, "조회 쿼리를"))).isEqualTo(Outcome.SAVED);
        Answer answer = answers.findWithQuestionBySessionId(session.getId()).getFirst();
        assertThat(answer.getInputType()).isEqualTo(InputType.VOICE);
        assertThat(answer.getContent()).isEqualTo("조회 쿼리를");
        assertThat(answer.getTokens()).hasSize(1);
        assertThat(answer.getSpeech()).isEqualTo(new AnswerSpeech(12.5, null));
        assertThat(answer.getStartedAt())
                .isEqualTo(OffsetDateTime.parse("2026-10-15T12:01:05.250+09:00"));
        assertThat(jobs.findAll())
                .anyMatch(
                        job ->
                                job.getJobType() == AiJobType.SCORE_ANSWER
                                        && job.getAnswerId().equals(answer.getId()));

        assertThat(results.handle(answerCompleted(session, 1, "다시"))).isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void answerCompletedForChatOrUnaskedQuestionIsDiscarded() {
        InterviewSession chat = startedSession(InterviewMode.CHAT);
        results.handle(questionStarted(chat, 1));
        assertThat(results.handle(answerCompleted(chat, 1, "답"))).isEqualTo(Outcome.DISCARDED);

        InterviewSession video = startedSession(InterviewMode.VIDEO);
        assertThat(results.handle(answerCompleted(video, 3, "답"))).isEqualTo(Outcome.DISCARDED);
        assertThatThrownBy(() -> results.handle(answerCompleted(video, 1, " ")))
                .isInstanceOf(InvalidAiResultException.class);
    }

    @Test
    void answerCompletedOutOfRangeIsInvalid() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);
        results.handle(questionStarted(session, 1));
        String valid = answerCompleted(session, 1, "답");

        for (String raw :
                List.of(
                        answerCompleted(session, 1, "가".repeat(10_001)),
                        valid.replace("\"startMs\":0", "\"startMs\":-1"),
                        valid.replace("\"endMs\":280", "\"endMs\":-5"),
                        valid.replace(
                                "\"answerStartedAt\":\"2026-10-15T12:01:05.250+09:00\",", ""))) {
            assertThatThrownBy(() -> results.handle(raw))
                    .as(raw)
                    .isInstanceOf(InvalidAiResultException.class);
        }
        assertThat(answers.findWithQuestionBySessionId(session.getId())).isEmpty();
        // 10,000자는 저장한다
        assertThat(results.handle(answerCompleted(session, 1, "가".repeat(10_000))))
                .isEqualTo(Outcome.SAVED);
    }

    @Test
    void firstScoreIsKeptAndOtherSessionIsDiscarded() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);
        results.handle(questionStarted(session, 1));
        results.handle(answerCompleted(session, 1, "답"));
        long answerId = answers.findWithQuestionBySessionId(session.getId()).getFirst().getId();

        assertThat(results.handle(answerScored(session.getId(), answerId, "PROBABILITY")))
                .isEqualTo(Outcome.SAVED);
        assertThat(results.handle(answerScored(session.getId(), answerId, "FIXED")))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(results.handle(answerScored(session.getId() + 1_000, answerId, "FIXED")))
                .isEqualTo(Outcome.DISCARDED);
        em.flush();
        em.clear();
        assertThat(answers.findById(answerId).orElseThrow().getEvaluation())
                .containsEntry("scoreMethod", "PROBABILITY");
    }

    @Test
    void assignmentRejectedBeforeFirstQuestionFailsStartOnce() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);

        assertThat(
                        results.handle(
                                assignmentRejected(
                                        session, "CAPACITY_EXCEEDED", afterStart(session))))
                .isEqualTo(Outcome.SAVED);
        assertThat(session.getStatus()).isEqualTo(SessionStatus.START_FAILED);
        verify(rooms).close(session.getId());

        // 같은 메시지가 다시 오면 버린다
        assertThat(
                        results.handle(
                                assignmentRejected(
                                        session, "CAPACITY_EXCEEDED", afterStart(session))))
                .isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void assignmentRejectedAfterQuestionOrBeforeRestartIsDiscarded() {
        // 질문을 낸 뒤에는 배정이 이미 된 것이다
        InterviewSession asked = startedSession(InterviewMode.CHAT);
        results.handle(questionStarted(asked, 1));
        assertThat(
                        results.handle(
                                assignmentRejected(asked, "INVALID_ASSIGNMENT", afterStart(asked))))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(asked.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);

        // 다시 시작하기 전에 보낸 거절이 늦게 왔다
        InterviewSession restarted = startedSession(InterviewMode.CHAT);
        String late =
                assignmentRejected(
                        restarted, "CAPACITY_EXCEEDED", restarted.getStartedAt().minusSeconds(1));
        assertThat(results.handle(late)).isEqualTo(Outcome.DISCARDED);
        assertThat(restarted.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);

        // 시작 전이면 버린다
        InterviewSession ready = newSession(InterviewMode.CHAT);
        assertThat(results.handle(assignmentRejected(ready, "CAPACITY_EXCEEDED", STARTED_AT)))
                .isEqualTo(Outcome.DISCARDED);
        verify(rooms, never()).close(anyLong());
    }

    @Test
    void assignmentRejectedWithoutReasonOrTimeIsInvalid() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);
        String valid = assignmentRejected(session, "CAPACITY_EXCEEDED", afterStart(session));

        for (String raw :
                List.of(
                        valid.replace("CAPACITY_EXCEEDED", "BUSY"),
                        valid.replace("\"reason\":\"CAPACITY_EXCEEDED\",", ""),
                        valid.replaceAll(",\"occurredAt\":\"[^\"]+\"", ""))) {
            assertThatThrownBy(() -> results.handle(raw))
                    .as(raw)
                    .isInstanceOf(InvalidAiResultException.class);
        }
        assertThat(session.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
    }

    @Test
    void unreadableMessagesAreInvalid() {
        for (String raw :
                List.of(
                        "not json",
                        "{\"type\":\"plan.progress\",\"progress\":50}",
                        "{\"type\":\"unknown.type\",\"sessionId\":1}",
                        "{\"type\":\"plan.progress\",\"sessionId\":1}",
                        "{\"type\":\"question.started\",\"sessionId\":1,\"seq\":6,"
                                + "\"startedAt\":\"2026-10-15T12:01:00+09:00\"}")) {
            assertThatThrownBy(() -> results.handle(raw))
                    .as(raw)
                    .isInstanceOf(InvalidAiResultException.class);
        }
    }

    private InterviewSession newSession(InterviewMode mode) {
        User user = new User("ai-result-" + UUID.randomUUID() + "@example.com", "hash", "결과");
        em.persist(user);
        Application application = new Application(user, "○○전자", "백엔드 개발자", "저는…");
        em.persist(application);
        InterviewSession session = new InterviewSession(user, application, Persona.DEVIL, mode);
        em.persist(session);
        em.flush();
        return session;
    }

    private InterviewSession startedSession(InterviewMode mode) {
        InterviewSession session = newSession(mode);
        savePlan(session);
        session.start(OffsetDateTime.now());
        em.flush();
        return session;
    }

    private void savePlan(InterviewSession session) {
        plans.save(
                new InterviewPlan(
                        session.getId(),
                        List.of(new PlanClaim("c1", "주장", "NUMBER", 1)),
                        IntStream.rangeClosed(1, 5)
                                .mapToObj(
                                        seq -> new PlanQuestion(seq, "질문" + seq, "기준" + seq, "c1"))
                                .toList(),
                        "plan-v1",
                        "gms-test"));
        em.flush();
    }

    private static String planProgress(InterviewSession session, int progress) {
        return """
        {"type":"plan.progress","sessionId":%d,"jobId":"j1","progress":%d}
        """
                .formatted(session.getId(), progress);
    }

    private static String planCompleted(InterviewSession session, int questionCount) {
        StringBuilder questionsJson = new StringBuilder();
        for (int seq = 1; seq <= questionCount; seq++) {
            questionsJson
                    .append(seq == 1 ? "" : ",")
                    .append(
                            """
                            {"seq":%d,"content":"질문%d","criteria":"기준%d","claimId":"c1"}
                            """
                                    .formatted(seq, seq, seq)
                                    .strip());
        }
        return """
        {"type":"plan.completed","sessionId":%d,"jobId":"j1",
         "claims":[{"id":"c1","text":"주장","type":"NUMBER","sentenceNo":1}],
         "questions":[%s],"promptVersion":"plan-v1","modelVersion":"gms-test"}
        """
                .formatted(session.getId(), questionsJson);
    }

    private static String planFailed(InterviewSession session) {
        return """
        {"type":"plan.failed","sessionId":%d,"jobId":"j1","reason":"GMS 실패"}
        """
                .formatted(session.getId());
    }

    private static String questionStarted(InterviewSession session, int seq) {
        return """
        {"type":"question.started","sessionId":%d,"seq":%d,
         "startedAt":"2026-10-15T12:01:00+09:00"}
        """
                .formatted(session.getId(), seq);
    }

    private static String answerCompleted(InterviewSession session, int seq, String content) {
        return """
        {"type":"answer.completed","sessionId":%d,"seq":%d,
         "answerStartedAt":"2026-10-15T12:01:05.250+09:00","content":"%s",
         "tokens":[{"text":"조회","startMs":0,"endMs":280}],
         "speech":{"trailingOffRatio":12.5,"pitchRangeSt":null},"endReason":"AUTO_SUBMIT"}
        """
                .formatted(session.getId(), seq, content);
    }

    private static String answerScored(long sessionId, long answerId, String scoreMethod) {
        return """
        {"type":"answer.scored","sessionId":%d,"jobId":"j2","answerId":%d,
         "evaluation":{"scoreMethod":"%s","criteria":{}}}
        """
                .formatted(sessionId, answerId, scoreMethod);
    }

    private static OffsetDateTime afterStart(InterviewSession session) {
        return session.getStartedAt().plusSeconds(1);
    }

    private static String assignmentRejected(
            InterviewSession session, String reason, OffsetDateTime occurredAt) {
        return """
        {"type":"assignment.rejected","sessionId":%d,"reason":"%s","occurredAt":"%s"}
        """
                .formatted(session.getId(), reason, occurredAt);
    }
}
