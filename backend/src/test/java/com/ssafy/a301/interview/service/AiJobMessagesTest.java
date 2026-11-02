package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.AnswerImpressions;
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

    // 자기소개서 문항은 적은 순서(item_order)대로 질문 · 답변만 보낸다(AI 명세 2장 · 4장). 넣은 순서는 반대다(newSession)
    private static final List<Map<String, Object>> COVER_LETTER_ITEMS =
            List.of(
                    Map.of("question", "지원 동기", "answer", "저는…"),
                    Map.of("question", "협업 경험", "answer", "함께했습니다."));

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
                        Map.entry("coverLetterItems", COVER_LETTER_ITEMS),
                        Map.entry("persona", "DEVIL"));
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
                .containsEntry("persona", "DEVIL")
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
        // 타임라인용 값은 채점에 쓰지 않아 작업 메시지에 담지 않는다(AI 명세 3장)
        AnswerSpeech speech =
                new AnswerSpeech(
                        12.5,
                        6.2,
                        List.of(9120),
                        new AnswerImpressions(
                                "impression-v1",
                                "jev-1.14.0",
                                List.of(
                                        new AnswerImpressions.Item(
                                                1500, 0.98, 62.5, 70.1, 55.0, 48.3, 66.0, 71.2))));
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
                .containsEntry("speech", new AnswerSpeech.Metrics(12.5, 6.2));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> answered =
                (List<Map<String, Object>>)
                        messages.of(withId(AiJob.evaluate(session.getId()))).get("answers");
        assertThat(answered.getFirst())
                .containsEntry("speech", new AnswerSpeech.Metrics(12.5, 6.2));
    }

    @Test
    void evaluateHasTimelineInputButScoreAnswerDoesNot() {
        // 다시보기 타임라인 입력은 결과 생성에만 보낸다(AI 명세 4장). 채점에는 쓰지 않는다
        InterviewSession session = plannedSession(InterviewMode.VIDEO);
        InterviewQuestion question = new InterviewQuestion(session, 1, "질문1");
        em.persist(question);
        AnswerImpressions impressions =
                new AnswerImpressions(
                        "impression-v1",
                        "jev-1.14.0",
                        List.of(
                                new AnswerImpressions.Item(
                                        1500, 0.98, 62.5, 70.1, 55.0, 48.3, 66.0, 71.2)));
        Answer answer =
                Answer.voice(
                        question,
                        "조회",
                        List.of(new AnswerToken("조회", 0, 280)),
                        new AnswerSpeech(12.5, 6.2, List.of(9120), impressions),
                        OffsetDateTime.parse("2026-10-22T14:02:18.250+09:00"));
        em.persist(answer);
        em.flush();

        assertThat(messages.of(withId(AiJob.scoreAnswer(session.getId(), answer.getId()))))
                .doesNotContainKey("timeline");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> answered =
                (List<Map<String, Object>>)
                        messages.of(withId(AiJob.evaluate(session.getId()))).get("answers");
        @SuppressWarnings("unchecked")
        Map<String, Object> timeline = (Map<String, Object>) answered.getFirst().get("timeline");
        assertThat(timeline)
                .containsEntry("trailingOffAtMs", List.of(9120))
                .containsEntry("impressions", impressions);
    }

    @Test
    void answerWithoutTimelineValuesHasNoTimelineInput() {
        InterviewSession session = plannedSession(InterviewMode.VIDEO);
        InterviewQuestion question = new InterviewQuestion(session, 1, "질문1");
        em.persist(question);
        Answer answer =
                Answer.voice(
                        question,
                        "조회",
                        null,
                        new AnswerSpeech(12.5, 6.2),
                        OffsetDateTime.parse("2026-10-22T14:02:18.250+09:00"));
        em.persist(answer);
        em.flush();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> answered =
                (List<Map<String, Object>>)
                        messages.of(withId(AiJob.evaluate(session.getId()))).get("answers");
        assertThat(answered.getFirst()).doesNotContainKey("timeline");
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
                .containsEntry("persona", "DEVIL")
                .containsEntry("coverLetterItems", COVER_LETTER_ITEMS)
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

    // 기준: ERD applications(지운 지원서로 본 면접도 남는다). 지원서를 지운 뒤에도 PLAN · EVALUATE에 지원서 내용이 들어간다
    @Test
    void deletedApplicationIsStillSentWithPlanAndEvaluate() {
        InterviewSession session = plannedSession(InterviewMode.CHAT);
        answer(session, 1, "답", null);
        session.getApplication().delete(KoreaTime.now());
        em.flush();
        em.clear();

        assertThat(messages.of(withId(AiJob.plan(session.getId()))))
                .containsEntry("companyName", "○○전자")
                .containsEntry("jobTitle", "백엔드 개발자")
                .containsEntry("coverLetterItems", COVER_LETTER_ITEMS);
        assertThat(messages.of(withId(AiJob.evaluate(session.getId()))))
                .containsEntry("coverLetterItems", COVER_LETTER_ITEMS);
    }

    // 기준: AI 명세 4장 earlierSummaries(같은 회원이 그날(한국 시간) 이 면접보다 먼저 시작해 결과가 나온 면접의 summary, 시작 순)
    @Test
    void evaluateMessageHasEarlierSummariesOfTheSameDay() {
        InterviewSession session = plannedSession(InterviewMode.CHAT);
        OffsetDateTime start = OffsetDateTime.parse("2026-10-27T15:00:00+09:00");
        ReflectionTestUtils.setField(session, "startedAt", start);
        completedBefore(session, start.minusHours(5), "아침");
        completedBefore(session, start.minusHours(1), "점심");
        // 전날, 나중에 시작한 면접은 넣지 않는다
        completedBefore(session, start.minusHours(16), "전날");
        completedBefore(session, start.plusHours(1), "나중");
        answer(session, 1, "답", null);

        assertThat(messages.of(withId(AiJob.evaluate(session.getId()))))
                .containsEntry("earlierSummaries", List.of("아침", "점심"));
    }

    private void completedBefore(InterviewSession of, OffsetDateTime startedAt, String summary) {
        InterviewSession other =
                new InterviewSession(
                        of.getUser(), of.getApplication(), Persona.DEVIL, InterviewMode.CHAT);
        em.persist(other);
        other.start(startedAt);
        other.end(startedAt.plusMinutes(10), 1);
        other.complete("한 줄", summary);
        em.flush();
    }

    @Test
    void mergeRecordingMessageHasTrackAndResultLocations() {
        InterviewSession session = newSession(InterviewMode.VIDEO);

        assertThat(messages.of(withId(AiJob.mergeRecording(session.getId()))))
                .containsEntry("jobType", "MERGE_RECORDING")
                .containsEntry("rawPrefix", "recordings/raw/" + session.getId() + "/")
                .containsEntry("objectKey", "recordings/" + session.getId() + ".mp4")
                .doesNotContainKey("persona");

        InterviewSession chat = newSession(InterviewMode.CHAT);
        assertThatThrownBy(() -> messages.of(withId(AiJob.mergeRecording(chat.getId()))))
                .isInstanceOf(IllegalStateException.class);
    }

    // 기준: AI 명세 1.3 persona(면접을 만들 때 고른 면접관)
    @Test
    void coffeeChatSessionSendsItsPersona() {
        InterviewSession session = plannedSession(InterviewMode.CHAT, Persona.COFFEE_CHAT);
        Answer answer = answer(session, 1, "답", null);

        assertThat(messages.of(withId(AiJob.plan(session.getId()))))
                .containsEntry("persona", "COFFEE_CHAT");
        assertThat(messages.of(withId(AiJob.scoreAnswer(session.getId(), answer.getId()))))
                .containsEntry("persona", "COFFEE_CHAT");
        assertThat(messages.of(withId(AiJob.evaluate(session.getId()))))
                .containsEntry("persona", "COFFEE_CHAT");
    }

    @Test
    void jobWithoutPlanCannotBeSent() {
        InterviewSession session = newSession(InterviewMode.CHAT);

        assertThatThrownBy(() -> messages.of(withId(AiJob.evaluate(session.getId()))))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> messages.of(withId(AiJob.plan(-1L))))
                .isInstanceOf(IllegalStateException.class);
    }

    // 문항 순서가 영속성 컨텍스트가 아니라 DB(item_order)에서 오는지 보려고, 문항은 순서를 거꾸로 직접 넣고
    // 컨텍스트를 비운 뒤 면접을 다시 읽어 돌려준다
    private InterviewSession newSession(InterviewMode mode) {
        return newSession(mode, Persona.DEVIL);
    }

    private InterviewSession newSession(InterviewMode mode, Persona persona) {
        User user = new User("job-msg-" + UUID.randomUUID() + "@example.com", "hash", "메시지");
        em.persist(user);
        Application application = new Application(user, "○○전자", "백엔드 개발자");
        em.persist(application);
        InterviewSession session = new InterviewSession(user, application, persona, mode);
        em.persist(session);
        em.flush();
        insertCoverLetterItem(application.getId(), 2, "협업 경험", "함께했습니다.");
        insertCoverLetterItem(application.getId(), 1, "지원 동기", "저는…");
        em.clear();
        return em.find(InterviewSession.class, session.getId());
    }

    private void insertCoverLetterItem(
            long applicationId, int itemOrder, String question, String answer) {
        em.createNativeQuery(
                        "INSERT INTO cover_letter_items (application_id, item_order, question,"
                                + " answer) VALUES (?1, ?2, ?3, ?4)")
                .setParameter(1, applicationId)
                .setParameter(2, itemOrder)
                .setParameter(3, question)
                .setParameter(4, answer)
                .executeUpdate();
    }

    private InterviewSession plannedSession(InterviewMode mode) {
        return plannedSession(mode, Persona.DEVIL);
    }

    private InterviewSession plannedSession(InterviewMode mode, Persona persona) {
        InterviewSession session = newSession(mode, persona);
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
