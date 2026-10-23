package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.AnswerSpeech;
import com.ssafy.a301.interview.domain.AnswerToken;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanClaim;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

/** 실제 PostgreSQL에서 읽은 내용으로 작업 메시지를 만드는지 확인한다(AI 명세 1.3·2~4장). */
@SpringBootTest
@Transactional
class AiJobMessagesTest {
    private static final UUID JOB_ID = UUID.fromString("8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34");
    // DB에서 읽은 시각은 UTC로 나오지만 메시지에는 한국 시간으로 쓴다
    private static final OffsetDateTime CREATED_AT = OffsetDateTime.parse("2026-10-22T05:03:13Z");

    @Autowired private AiJobMessages messages;
    @Autowired private InterviewPlanRepository plans;
    @Autowired private EntityManager em;

    @Test
    void planMessageHasApplication() {
        InterviewSession session = newSession(InterviewMode.CHAT);

        assertThat(messages.of(withId(AiJob.plan(session.getId()))))
                .containsExactly(
                        Map.entry("jobType", "PLAN"),
                        Map.entry("jobId", JOB_ID.toString()),
                        Map.entry("sessionId", session.getId()),
                        Map.entry("requestedAt", "2026-10-22T14:03:13+09:00"),
                        Map.entry("companyName", "○○전자"),
                        Map.entry("jobTitle", "백엔드 개발자"),
                        Map.entry("coverLetter", "저는…"));
    }

    @Test
    void scoreAnswerMessageHasQuestionCriteriaAndAnswer() {
        InterviewSession session = plannedSession(InterviewMode.VIDEO);
        List<AnswerToken> tokens = List.of(new AnswerToken("조회", 0, 280));
        Answer answer = answer(session, 2, "조회 쿼리를", tokens);

        Map<String, Object> message =
                messages.of(withId(AiJob.scoreAnswer(session.getId(), answer.getId())));

        assertThat(message)
                .containsEntry("jobType", "SCORE_ANSWER")
                .containsEntry("answerId", answer.getId())
                .containsEntry("mode", "VIDEO")
                .containsEntry("seq", 2)
                .containsEntry("question", "질문2")
                .containsEntry("criteria", "기준2")
                .containsEntry("content", "조회 쿼리를")
                .containsEntry("tokens", tokens);
    }

    @Test
    void videoAnswerSpeechIsSentWithScoreAnswerAndEvaluate() {
        InterviewSession session = plannedSession(InterviewMode.VIDEO);
        InterviewQuestion question = new InterviewQuestion(session, 1, "질문1");
        em.persist(question);
        AnswerSpeech speech = new AnswerSpeech(12.5, 6.2);
        Answer answer =
                Answer.voice(
                        question,
                        "조회",
                        List.of(new AnswerToken("조회", 0, 280)),
                        speech,
                        OffsetDateTime.parse("2026-10-22T14:02:18.250+09:00"));
        em.persist(answer);
        em.flush();

        assertThat(messages.of(withId(AiJob.scoreAnswer(session.getId(), answer.getId()))))
                .containsEntry("speech", speech);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> answered =
                (List<Map<String, Object>>)
                        messages.of(withId(AiJob.evaluate(session.getId()))).get("answers");
        assertThat(answered.getFirst()).containsEntry("speech", speech);
    }

    @Test
    void chatScoreAnswerHasNoTokens() {
        InterviewSession session = plannedSession(InterviewMode.CHAT);
        Answer answer = answer(session, 1, "답", null);

        assertThat(messages.of(withId(AiJob.scoreAnswer(session.getId(), answer.getId()))))
                .containsEntry("mode", "CHAT")
                .doesNotContainKey("tokens")
                .doesNotContainKey("speech");
    }

    @Test
    void evaluateMessageHasClaimsAndAnswersInOrder() {
        InterviewSession session = plannedSession(InterviewMode.CHAT);
        Answer second = answer(session, 2, "둘째", null);
        Answer first = answer(session, 1, "첫째", null);
        first.recordEvaluation(Map.of("scoreMethod", "FIXED"));
        em.flush();

        Map<String, Object> message = messages.of(withId(AiJob.evaluate(session.getId())));

        assertThat(message)
                .containsEntry("mode", "CHAT")
                .containsEntry("coverLetter", "저는…")
                .containsEntry("claims", List.of(new PlanClaim("c1", "주장", "NUMBER", 1)));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> answered = (List<Map<String, Object>>) message.get("answers");
        assertThat(answered)
                .extracting(item -> item.get("answerId"))
                .containsExactly(first.getId(), second.getId());
        assertThat(answered.getFirst())
                .containsEntry("question", "질문1")
                .containsEntry("evaluation", Map.of("scoreMethod", "FIXED"));
        // 채점 전이면 evaluation은 null로 보낸다
        assertThat(answered.get(1)).containsEntry("evaluation", null);
    }

    @Test
    void mergeRecordingMessageHasTrackAndResultLocations() {
        InterviewSession session = newSession(InterviewMode.VIDEO);

        assertThat(messages.of(withId(AiJob.mergeRecording(session.getId()))))
                .containsEntry("jobType", "MERGE_RECORDING")
                .containsEntry("rawPrefix", "recordings/raw/" + session.getId() + "/")
                .containsEntry("objectKey", "recordings/" + session.getId() + ".mp4");

        InterviewSession chat = newSession(InterviewMode.CHAT);
        assertThatThrownBy(() -> messages.of(withId(AiJob.mergeRecording(chat.getId()))))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void jobWithoutPlanCannotBeSent() {
        InterviewSession session = newSession(InterviewMode.CHAT);

        assertThatThrownBy(() -> messages.of(withId(AiJob.evaluate(session.getId()))))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> messages.of(withId(AiJob.plan(-1L))))
                .isInstanceOf(IllegalStateException.class);
    }

    private InterviewSession newSession(InterviewMode mode) {
        User user = new User("job-msg-" + UUID.randomUUID() + "@example.com", "hash", "메시지");
        em.persist(user);
        Application application = new Application(user, "○○전자", "백엔드 개발자", "저는…");
        em.persist(application);
        InterviewSession session = new InterviewSession(user, application, Persona.DEVIL, mode);
        em.persist(session);
        em.flush();
        return session;
    }

    private InterviewSession plannedSession(InterviewMode mode) {
        InterviewSession session = newSession(mode);
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
        session.start(OffsetDateTime.now());
        em.flush();
        return session;
    }

    private Answer answer(
            InterviewSession session, int seq, String content, List<AnswerToken> tokens) {
        InterviewQuestion question = new InterviewQuestion(session, seq, "질문" + seq);
        em.persist(question);
        Answer answer =
                new Answer(
                        question,
                        tokens == null ? InputType.TEXT : InputType.VOICE,
                        content,
                        tokens);
        em.persist(answer);
        em.flush();
        return answer;
    }

    private static AiJob withId(AiJob job) {
        ReflectionTestUtils.setField(job, "id", JOB_ID);
        ReflectionTestUtils.setField(job, "createdAt", CREATED_AT);
        return job;
    }
}
