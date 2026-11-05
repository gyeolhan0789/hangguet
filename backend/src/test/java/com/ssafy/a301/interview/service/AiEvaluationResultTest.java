package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.tuple;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.interview.InMemorySessionRuntimeStore;
import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.AnswerSpeech;
import com.ssafy.a301.interview.domain.AnswerToken;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.domain.RecordingStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.SessionScoreRepository;
import com.ssafy.a301.interview.service.AiResultService.Outcome;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Consumer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL로 결과 생성(evaluation.*)·녹화 합치기(recording.*) 결과의 저장과 버림 조건을 확인한다. Redis 진행 상태는 메모리
 * 저장소다.
 */
@SpringBootTest
@Transactional
@Import(InMemorySessionRuntimeStore.Config.class)
class AiEvaluationResultTest {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final UUID JOB_ID = UUID.fromString("8f0c2b9e-3f7a-4c1d-9a8e-2b5d7c0e1f34");

    @Autowired private AiResultService results;
    @Autowired private InMemorySessionRuntimeStore runtimes;
    @Autowired private SessionScoreRepository sessionScores;
    @Autowired private EntityManager em;
    @MockitoBean private AiJobQueue queue;

    @BeforeEach
    void setUp() {
        runtimes.clear();
    }

    @Test
    void progressIsKeptOnlyForLatestEvaluate() {
        InterviewSession session = analyzing(InterviewMode.CHAT, 1);

        assertThat(results.handle(progress(session, JOB_ID, "SCORING"))).isEqualTo(Outcome.SAVED);
        assertThat(analysisStep(session)).isEqualTo(AnalysisStep.SCORING);

        // 5.9로 다시 만들기 전 작업의 늦은 진행 상황은 버린다
        assertThat(results.handle(progress(session, UUID.randomUUID(), "WRITING_FEEDBACK")))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(analysisStep(session)).isEqualTo(AnalysisStep.SCORING);
        assertThatThrownBy(() -> results.handle(progress(session, JOB_ID, "UNKNOWN")))
                .isInstanceOf(InvalidAiResultException.class);
    }

    @Test
    void completedVideoResultIsSavedOnceInOneGo() {
        InterviewSession session = analyzing(InterviewMode.VIDEO, 2);
        List<Answer> answered = answersOf(session);
        Map<String, Object> message = completed(session, JOB_ID, answered);
        message.put(
                "speechMetrics",
                Map.of(
                        "fillerPerMin", 3.456,
                        "longPauseCount", 2,
                        "speedDeviationPct", -12.5,
                        "trailingOffRatio", 10.0));

        assertThat(results.handle(json(message))).isEqualTo(Outcome.SAVED);
        em.flush();
        em.clear();

        InterviewSession saved = em.find(InterviewSession.class, session.getId());
        assertThat(saved.getStatus()).isEqualTo(SessionStatus.COMPLETED);
        assertThat(saved.getHeadline()).isEqualTo("근거는 분명하나 결론이 늦어요");
        assertThat(saved.getSummary()).isEqualTo("총평");
        Answer first = em.find(Answer.class, answered.getFirst().getId());
        assertThat(first.getScore()).isEqualTo(80);
        assertThat(first.getGoodPoint()).isEqualTo("잘한 점1");
        assertThat(first.getImprovePoint()).isEqualTo("고칠 점1");
        // 확정본으로 덮어쓴다
        assertThat(first.getEvaluation()).containsEntry("scoreMethod", "FINAL");
        assertThat(sessionScores.findBySessionIds(List.of(session.getId())))
                .extracting(SessionScore::getCriterion, SessionScore::getScore)
                .containsExactlyInAnyOrder(
                        tuple(Criterion.JOB_FIT, 70),
                        tuple(Criterion.COVER_LETTER, 70),
                        tuple(Criterion.LOGIC, 70),
                        tuple(Criterion.DELIVERY, 70));
        SpeechMetric metric = em.find(SpeechMetric.class, session.getId());
        assertThat(metric.getFillerPerMin()).isEqualByComparingTo("3.46");
        assertThat(metric.getLongPauseCount()).isEqualTo(2);
        assertThat(metric.getSpeedDeviationPct()).isEqualByComparingTo("-12.50");
        assertThat(metric.getPitchRangeSt()).isNull();
        assertThat(analysisStep(session)).isNull();

        // 같은 결과가 다시 오면 버린다
        assertThat(results.handle(json(message))).isEqualTo(Outcome.DISCARDED);
    }

    // 기준: API 명세 5.8 gazeRatio. 시선 비율은 AI 결과가 아니라 5.8에서 먼저 저장되므로 결과를 쓸 때 잃지 않는다
    @Test
    void gazeRatioFromEndIsKeptWhenResultIsSaved() {
        InterviewSession withMetrics = gazeOnly(analyzing(InterviewMode.VIDEO, 1));
        InterviewSession withoutMetrics = gazeOnly(analyzing(InterviewMode.VIDEO, 1));
        Map<String, Object> message = completed(withMetrics, JOB_ID, answersOf(withMetrics));
        message.put("speechMetrics", Map.of("fillerPerMin", 3.0));

        assertThat(results.handle(json(message))).isEqualTo(Outcome.SAVED);
        assertThat(
                        results.handle(
                                json(completed(withoutMetrics, JOB_ID, answersOf(withoutMetrics)))))
                .isEqualTo(Outcome.SAVED);
        em.flush();
        em.clear();

        SpeechMetric metric = em.find(SpeechMetric.class, withMetrics.getId());
        assertThat(metric.getFillerPerMin()).isEqualByComparingTo("3.00");
        assertThat(metric.getGazeRatio()).isEqualByComparingTo("72.46");
        // AI가 말하기 지표를 보내지 않아도 시선 비율은 남는다
        assertThat(em.find(SpeechMetric.class, withoutMetrics.getId()).getGazeRatio())
                .isEqualByComparingTo("72.46");
    }

    private InterviewSession gazeOnly(InterviewSession session) {
        SpeechMetric metric = new SpeechMetric(session, null, null, null, null, null);
        metric.recordGazeRatio(new BigDecimal("72.46"));
        em.persist(metric);
        em.flush();
        // 실제로는 5.8과 결과 저장이 다른 트랜잭션이다
        em.clear();
        return session;
    }

    @Test
    void retriedEvaluationReplacesResultsAndIgnoresPreviousJob() {
        InterviewSession session = analyzing(InterviewMode.CHAT, 1);
        List<Answer> answered = answersOf(session);
        // 지난 시도에 남은 기준 점수
        sessionScores.save(new SessionScore(session, Criterion.LOGIC, 10, "예전"));
        em.flush();
        UUID retried = UUID.randomUUID();
        runtimes.startAnalysis(session.getId(), OffsetDateTime.now().toInstant(), retried);

        assertThat(results.handle(json(completed(session, JOB_ID, answered))))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(results.handle(json(completed(session, retried, answered))))
                .isEqualTo(Outcome.SAVED);
        em.flush();
        em.clear();

        assertThat(sessionScores.findBySessionIds(List.of(session.getId())))
                .hasSize(4)
                .allSatisfy(score -> assertThat(score.getScore()).isEqualTo(70));
        // 채팅은 말하기 지표가 없다
        assertThat(em.find(SpeechMetric.class, session.getId())).isNull();
    }

    @Test
    @SuppressWarnings("unchecked")
    void completedOutOfContractIsInvalidAndSavesNothing() {
        InterviewSession session = analyzing(InterviewMode.VIDEO, 2);
        List<Answer> answered = answersOf(session);
        List<Consumer<Map<String, Object>>> breakers =
                List.of(
                        m -> m.put("summary", "가".repeat(256)),
                        m -> m.put("summary", " "),
                        m -> m.put("answers", answersJson(answered.subList(0, 1))),
                        m ->
                                ((List<Map<String, Object>>) m.get("answers"))
                                        .getFirst()
                                        .put("score", 101),
                        m -> ((List<Map<String, Object>>) m.get("sessionScores")).removeLast(),
                        m ->
                                ((List<Map<String, Object>>) m.get("sessionScores"))
                                        .getFirst()
                                        .put("criterion", "LOGIC"),
                        m -> m.put("speechMetrics", Map.of("fillerPerMin", 1000)));
        for (Consumer<Map<String, Object>> breaker : breakers) {
            Map<String, Object> message = completed(session, JOB_ID, answered);
            breaker.accept(message);

            assertThatThrownBy(() -> results.handle(json(message)))
                    .as(message.toString())
                    .isInstanceOf(InvalidAiResultException.class);
        }
        em.flush();
        em.clear();
        assertThat(em.find(InterviewSession.class, session.getId()).getStatus())
                .isEqualTo(SessionStatus.ANALYZING);
        assertThat(sessionScores.findBySessionIds(List.of(session.getId()))).isEmpty();
    }

    @Test
    void failedResultFailsOnlyLatestAnalysis() {
        InterviewSession session = analyzing(InterviewMode.CHAT, 1);

        assertThat(results.handle(failed(session, UUID.randomUUID()))).isEqualTo(Outcome.DISCARDED);
        assertThat(results.handle(failed(session, JOB_ID))).isEqualTo(Outcome.SAVED);
        assertThat(session.getStatus()).isEqualTo(SessionStatus.FAILED);
        assertThat(analysisStep(session)).isNull();
        assertThat(results.handle(failed(session, JOB_ID))).isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void mergedRecordingChangesMergingToReadyOnce() {
        InterviewSession session = analyzing(InterviewMode.VIDEO, 1);
        em.persist(Recording.mergingSessionVideo(session));

        assertThat(results.handle(merged(session))).isEqualTo(Outcome.SAVED);
        assertThat(results.handle(merged(session))).isEqualTo(Outcome.DISCARDED);
        assertThat(sessionVideos(session))
                .singleElement()
                .satisfies(
                        r -> {
                            assertThat(r.getStatus()).isEqualTo(RecordingStatus.READY);
                            assertThat(r.getObjectKey())
                                    .isEqualTo("recordings/" + session.getId() + ".mp4");
                        });

        // 다른 면접의 위치는 받지 않는다
        assertThatThrownBy(() -> results.handle(merged(session.getId(), "recordings/1.mp4")))
                .isInstanceOf(InvalidAiResultException.class);
    }

    @Test
    void mergedRecordingWithoutMergingRowIsSavedAsReady() {
        // V10 이전에 끝나 MERGING 행이 없는 면접
        InterviewSession session = analyzing(InterviewMode.VIDEO, 1);

        assertThat(results.handle(merged(session))).isEqualTo(Outcome.SAVED);
        assertThat(sessionVideos(session))
                .singleElement()
                .satisfies(r -> assertThat(r.getStatus()).isEqualTo(RecordingStatus.READY));
    }

    // 기준: AI 명세 7장 · BE 설계 처리 순서 11(READY로 바꿀 때 영상 0초 시각을 저장한다. 이어 붙여 합쳤으면 null)
    @Test
    void mergedRecordingKeepsRecordingStartedAt() {
        InterviewSession merging = analyzing(InterviewMode.VIDEO, 1);
        em.persist(Recording.mergingSessionVideo(merging));
        InterviewSession withoutRow = analyzing(InterviewMode.VIDEO, 1);
        InterviewSession appended = analyzing(InterviewMode.VIDEO, 1);
        em.persist(Recording.mergingSessionVideo(appended));

        assertThat(results.handle(merged(merging, "2026-11-04T10:00:03.250+09:00")))
                .isEqualTo(Outcome.SAVED);
        assertThat(results.handle(merged(withoutRow, "2026-11-04T10:00:04.500+09:00")))
                .isEqualTo(Outcome.SAVED);
        assertThat(results.handle(merged(appended, null))).isEqualTo(Outcome.SAVED);
        // DB에 저장한 값을 읽는다
        em.flush();
        em.clear();

        assertThat(sessionVideos(merging))
                .singleElement()
                .satisfies(
                        r ->
                                assertThat(r.getRecordingStartedAt())
                                        .isAtSameInstantAs(
                                                OffsetDateTime.parse(
                                                        "2026-11-04T10:00:03.250+09:00")));
        assertThat(sessionVideos(withoutRow))
                .singleElement()
                .satisfies(
                        r ->
                                assertThat(r.getRecordingStartedAt())
                                        .isAtSameInstantAs(
                                                OffsetDateTime.parse(
                                                        "2026-11-04T10:00:04.500+09:00")));
        assertThat(sessionVideos(appended))
                .singleElement()
                .satisfies(r -> assertThat(r.getRecordingStartedAt()).isNull());
    }

    @Test
    void mergedAgainAfterReadyKeepsFirstRecordingStartedAt() {
        // 이미 READY이면 버리므로 늦게 온 같은 결과가 0초 시각을 바꾸지 않는다
        InterviewSession session = analyzing(InterviewMode.VIDEO, 1);
        em.persist(Recording.mergingSessionVideo(session));
        results.handle(merged(session, "2026-11-04T10:00:03.250+09:00"));

        assertThat(results.handle(merged(session, "2026-11-04T10:09:00.000+09:00")))
                .isEqualTo(Outcome.DISCARDED);
        em.flush();
        em.clear();
        assertThat(sessionVideos(session))
                .singleElement()
                .satisfies(
                        r ->
                                assertThat(r.getRecordingStartedAt())
                                        .isAtSameInstantAs(
                                                OffsetDateTime.parse(
                                                        "2026-11-04T10:00:03.250+09:00")));
    }

    @Test
    void mergeFailedChangesMergingToFailed() {
        InterviewSession session = analyzing(InterviewMode.VIDEO, 1);
        em.persist(Recording.mergingSessionVideo(session));

        assertThat(results.handle(mergeFailed(session))).isEqualTo(Outcome.SAVED);
        assertThat(sessionVideos(session))
                .singleElement()
                .satisfies(r -> assertThat(r.getStatus()).isEqualTo(RecordingStatus.FAILED));
    }

    @Test
    void mergedAfterFailureBecomesReady() {
        // 파일이 올라왔으면 앞서 받은 실패보다 우선한다
        InterviewSession session = analyzing(InterviewMode.VIDEO, 1);
        em.persist(Recording.mergingSessionVideo(session));
        results.handle(mergeFailed(session));

        assertThat(results.handle(merged(session))).isEqualTo(Outcome.SAVED);
        assertThat(sessionVideos(session))
                .singleElement()
                .satisfies(r -> assertThat(r.getStatus()).isEqualTo(RecordingStatus.READY));
    }

    @Test
    void mergeFailedIsDiscardedWhenReadyOrWithoutRow() {
        InterviewSession ready = analyzing(InterviewMode.VIDEO, 1);
        em.persist(Recording.mergingSessionVideo(ready));
        results.handle(merged(ready));
        assertThat(results.handle(mergeFailed(ready))).isEqualTo(Outcome.DISCARDED);
        assertThat(sessionVideos(ready))
                .singleElement()
                .satisfies(r -> assertThat(r.getStatus()).isEqualTo(RecordingStatus.READY));

        InterviewSession withoutRow = analyzing(InterviewMode.VIDEO, 1);
        assertThat(results.handle(mergeFailed(withoutRow))).isEqualTo(Outcome.DISCARDED);
        assertThat(sessionVideos(withoutRow)).isEmpty();
    }

    // 기준: AI 명세 4장(headline은 30자 이내, 넘으면 자른다. 없으면(이전 AI) 비워 둔다)
    @Test
    void longHeadlineIsCutAndMissingHeadlineIsEmpty() {
        InterviewSession longOne = analyzing(InterviewMode.CHAT, 1);
        Map<String, Object> message = completed(longOne, JOB_ID, answersOf(longOne));
        message.put("headline", "가".repeat(29) + "😀끝");
        assertThat(results.handle(json(message))).isEqualTo(Outcome.SAVED);

        InterviewSession missing = analyzing(InterviewMode.CHAT, 1);
        Map<String, Object> old = completed(missing, JOB_ID, answersOf(missing));
        old.remove("headline");
        assertThat(results.handle(json(old))).isEqualTo(Outcome.SAVED);
        em.flush();
        em.clear();

        assertThat(em.find(InterviewSession.class, longOne.getId()).getHeadline())
                .isEqualTo("가".repeat(29) + "😀");
        assertThat(em.find(InterviewSession.class, missing.getId()).getHeadline()).isNull();
    }

    @Test
    void recordingResultsOfChatSessionAreDiscarded() {
        InterviewSession chat = analyzing(InterviewMode.CHAT, 1);

        assertThat(results.handle(merged(chat))).isEqualTo(Outcome.DISCARDED);
        assertThat(results.handle(mergeFailed(chat))).isEqualTo(Outcome.DISCARDED);
        assertThat(sessionVideos(chat)).isEmpty();
    }

    private List<Recording> sessionVideos(InterviewSession session) {
        em.flush();
        return em.createQuery("select r from Recording r where r.session.id = :id", Recording.class)
                .setParameter("id", session.getId())
                .getResultList();
    }

    // 답변 수만큼 질문·답변을 남기고 끝내 결과 생성을 시작한 면접(마지막 EVALUATE는 JOB_ID)
    private InterviewSession analyzing(InterviewMode mode, int answerCount) {
        User user = new User("ai-eval-" + UUID.randomUUID() + "@example.com", "hash", "결과");
        em.persist(user);
        Application application = new Application(user, "○○전자", "백엔드 개발자");
        em.persist(application);
        InterviewSession session = new InterviewSession(user, application, Persona.DEVIL, mode);
        em.persist(session);
        session.start(OffsetDateTime.now());
        for (int seq = 1; seq <= answerCount; seq++) {
            InterviewQuestion question = new InterviewQuestion(session, seq, "질문" + seq);
            em.persist(question);
            em.persist(
                    mode == InterviewMode.VIDEO
                            ? Answer.voice(
                                    question,
                                    "답" + seq,
                                    List.of(new AnswerToken("답", 0, 200)),
                                    new AnswerSpeech(10.0, 5.0),
                                    null,
                                    OffsetDateTime.now())
                            : new Answer(question, InputType.TEXT, "답" + seq));
        }
        session.end(OffsetDateTime.now(), answerCount);
        em.flush();
        runtimes.values.put(session.getId(), new SessionRuntime(PlanStatus.READY, null, null, 0));
        runtimes.startAnalysis(session.getId(), OffsetDateTime.now().toInstant(), JOB_ID);
        return session;
    }

    private List<Answer> answersOf(InterviewSession session) {
        return em.createQuery(
                        "select a from Answer a where a.question.session.id = :id order by a.id",
                        Answer.class)
                .setParameter("id", session.getId())
                .getResultList();
    }

    private AnalysisStep analysisStep(InterviewSession session) {
        return runtimes.find(session.getId()).orElseThrow().analysisStep();
    }

    private static Map<String, Object> completed(
            InterviewSession session, UUID jobId, List<Answer> answered) {
        List<Map<String, Object>> scores = new ArrayList<>();
        for (Criterion criterion : Criterion.values()) {
            scores.add(
                    new LinkedHashMap<>(
                            Map.of("criterion", criterion.name(), "score", 70, "comment", "코멘트")));
        }
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("type", "evaluation.completed");
        message.put("sessionId", session.getId());
        message.put("jobId", jobId.toString());
        message.put("answers", answersJson(answered));
        message.put("sessionScores", scores);
        message.put("headline", "근거는 분명하나 결론이 늦어요");
        message.put("summary", "총평");
        return message;
    }

    private static List<Map<String, Object>> answersJson(List<Answer> answered) {
        List<Map<String, Object>> items = new ArrayList<>();
        for (int i = 0; i < answered.size(); i++) {
            items.add(
                    new LinkedHashMap<>(
                            Map.of(
                                    "answerId",
                                    answered.get(i).getId(),
                                    "score",
                                    80,
                                    "goodPoint",
                                    "잘한 점" + (i + 1),
                                    "improvePoint",
                                    "고칠 점" + (i + 1),
                                    "evaluation",
                                    Map.of("scoreMethod", "FINAL"))));
        }
        return items;
    }

    private static String progress(InterviewSession session, UUID jobId, String step) {
        return json(
                Map.of(
                        "type",
                        "evaluation.progress",
                        "sessionId",
                        session.getId(),
                        "jobId",
                        jobId.toString(),
                        "analysisStep",
                        step));
    }

    private static String failed(InterviewSession session, UUID jobId) {
        return json(
                Map.of(
                        "type",
                        "evaluation.failed",
                        "sessionId",
                        session.getId(),
                        "jobId",
                        jobId.toString(),
                        "reason",
                        "GMS_UNAVAILABLE"));
    }

    private static String merged(InterviewSession session) {
        return merged(session.getId(), Recording.sessionVideoKey(session.getId()));
    }

    private static String mergeFailed(InterviewSession session) {
        return json(
                Map.of(
                        "type",
                        "recording.mergeFailed",
                        "sessionId",
                        session.getId(),
                        "jobId",
                        JOB_ID.toString(),
                        "reason",
                        "TRACK_NOT_FOUND"));
    }

    private static String merged(long sessionId, String objectKey) {
        return json(mergedMessage(sessionId, objectKey));
    }

    private static String merged(InterviewSession session, String recordingStartedAt) {
        Map<String, Object> message =
                mergedMessage(session.getId(), Recording.sessionVideoKey(session.getId()));
        message.put("recordingStartedAt", recordingStartedAt);
        return json(message);
    }

    private static Map<String, Object> mergedMessage(long sessionId, String objectKey) {
        return new LinkedHashMap<>(
                Map.of(
                        "type",
                        "recording.merged",
                        "sessionId",
                        sessionId,
                        "jobId",
                        JOB_ID.toString(),
                        "objectKey",
                        objectKey));
    }

    private static String json(Map<String, Object> message) {
        return JSON.writeValueAsString(message);
    }
}
