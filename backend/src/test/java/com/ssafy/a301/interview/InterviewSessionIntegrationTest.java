package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.idempotency.IdempotencyStore;
import com.ssafy.a301.interview.domain.AiJobType;
import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.SessionRuntimeStore;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL로 5.1~5.9 흐름(만들기 → 조회 → 시작 → 답변 → 끝내기 → 결과 재생성)과 소유권·상태 오류를 확인한다. Redis 진행 상태는 메모리
 * 저장소, 작업 큐·멱등 키 저장소는 가짜로 바꾼다. 만든 회원과 데이터만 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class InterviewSessionIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private UserRepository users;
    @Autowired private ApplicationRepository applications;
    @Autowired private InterviewSessionRepository sessions;
    @Autowired private InterviewQuestionRepository questions;
    @Autowired private AnswerRepository answers;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private InMemoryRuntimeStore runtimes;
    @MockitoBean private AiJobQueue queue;
    @MockitoBean private IdempotencyStore idempotency;
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<Long> userIds = new ArrayList<>();

    @BeforeEach
    void setUp() {
        runtimes.values.clear();
        runtimes.analysisStartedAt.clear();
    }

    @AfterEach
    void cleanup() {
        for (long id : userIds) {
            String sessionsOfUser = "SELECT id FROM interview_sessions WHERE user_id = " + id;
            jdbc.update(
                    "DELETE FROM answers WHERE question_id IN (SELECT id FROM interview_questions"
                            + " WHERE session_id IN ("
                            + sessionsOfUser
                            + "))");
            jdbc.update(
                    "DELETE FROM interview_questions WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM interview_plans WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM ai_job_outbox WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM practice_logs WHERE user_id = ?", id);
            jdbc.update("DELETE FROM interview_sessions WHERE user_id = ?", id);
            jdbc.update("DELETE FROM applications WHERE user_id = ?", id);
            jdbc.update("DELETE FROM users WHERE id = ?", id);
        }
    }

    @Test
    void createStartsPlanAndSendsPlanJob() throws Exception {
        long user = newUser();
        long application = newApplication(user);

        long sessionId = create(user, application);

        assertThat(runtimes.find(sessionId))
                .contains(new SessionRuntime(PlanStatus.GENERATING, 0, null, 0));
        verify(queue)
                .push(
                        argThat(
                                job ->
                                        job.getJobType() == AiJobType.PLAN
                                                && job.getSessionId() == sessionId));
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.companyName").value("○○전자"))
                .andExpect(jsonPath("$.status").value("READY"))
                .andExpect(jsonPath("$.planStatus").value("GENERATING"))
                .andExpect(jsonPath("$.planProgress").value(0))
                .andExpect(jsonPath("$.currentQuestion").doesNotExist())
                .andExpect(jsonPath("$.leveledUp").doesNotExist());
        // 면접에 쓴 지원서는 지울 수 없다
        mvc.perform(as(user, delete("/api/v1/applications/" + application)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_IN_USE"));
    }

    @Test
    void othersApplicationAndSessionLookMissing() throws Exception {
        long owner = newUser();
        long other = newUser();
        long application = newApplication(owner);
        long sessionId = create(owner, application);

        mvc.perform(createRequest(other, application))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        for (MockHttpServletRequestBuilder request :
                new MockHttpServletRequestBuilder[] {
                    get("/api/v1/interview-sessions/" + sessionId),
                    post("/api/v1/interview-sessions/" + sessionId + "/plan/retry"),
                    idempotent(post("/api/v1/interview-sessions/" + sessionId + "/start")),
                    get("/api/v1/interview-sessions/" + sessionId + "/questions/current")
                }) {
            mvc.perform(as(other, request))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        }
    }

    @Test
    void retryOnlyAfterPlanFailed() throws Exception {
        long user = newUser();
        long sessionId = create(user, newApplication(user));

        mvc.perform(as(user, post("/api/v1/interview-sessions/" + sessionId + "/plan/retry")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PLAN_NOT_FAILED"));

        runtimes.values.put(sessionId, new SessionRuntime(PlanStatus.FAILED, null, null, 0));
        mvc.perform(as(user, post("/api/v1/interview-sessions/" + sessionId + "/plan/retry")))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.planStatus").value("GENERATING"))
                .andExpect(jsonPath("$.planProgress").value(0));
        verify(queue, times(2))
                .push(
                        argThat(
                                job ->
                                        job.getJobType() == AiJobType.PLAN
                                                && job.getSessionId() == sessionId));
    }

    @Test
    void startNeedsReadyPlanAndGivesFirstQuestion() throws Exception {
        long user = newUser();
        long sessionId = create(user, newApplication(user));
        String start = "/api/v1/interview-sessions/" + sessionId + "/start";

        mvc.perform(as(user, idempotent(post(start))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PLAN_NOT_READY"));

        planReady(sessionId);
        mvc.perform(as(user, idempotent(post(start))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.planStatus").value("READY"))
                .andExpect(jsonPath("$.currentQuestion.seq").value(1))
                .andExpect(jsonPath("$.currentQuestion.content").value("질문1"))
                .andExpect(jsonPath("$.answeredCount").value(0))
                .andExpect(jsonPath("$.startedAt").exists());

        mvc.perform(as(user, idempotent(post(start))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
        assertThat(questions.findFirstBySessionIdOrderBySeqDesc(sessionId))
                .hasValueSatisfying(q -> assertThat(q.getSeq()).isEqualTo(1));
    }

    @Test
    void currentQuestionFollowsAnswers() throws Exception {
        long user = newUser();
        long sessionId = create(user, newApplication(user));
        String current = "/api/v1/interview-sessions/" + sessionId + "/questions/current";

        mvc.perform(as(user, get(current)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        planReady(sessionId);
        mvc.perform(
                        as(
                                user,
                                idempotent(
                                        post(
                                                "/api/v1/interview-sessions/"
                                                        + sessionId
                                                        + "/start"))))
                .andExpect(status().isOk());
        mvc.perform(as(user, get(current)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.seq").value(1))
                .andExpect(jsonPath("$.createdAt").exists());

        // 1번에 답했고 다음 질문은 아직 없다
        answer(sessionId, 1);
        mvc.perform(as(user, get(current)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.code").value("QUESTION_GENERATING"));
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(jsonPath("$.answeredCount").value(1))
                .andExpect(jsonPath("$.currentQuestion").doesNotExist());

        // 5번까지 답하면 더 낼 질문이 없다
        for (int seq = 2; seq <= 5; seq++) {
            ask(sessionId, seq);
            answer(sessionId, seq);
        }
        mvc.perform(as(user, get(current)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
    }

    @Test
    void createNeedsIdempotencyKeyAndValidBody() throws Exception {
        long user = newUser();

        mvc.perform(
                        as(user, post("/api/v1/interview-sessions"))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{\"applicationId\": 1, \"persona\": \"DEVIL\", \"mode\":"
                                                + " \"VIDEO\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("Idempotency-Key"));
        mvc.perform(
                        as(user, idempotent(post("/api/v1/interview-sessions")))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"applicationId\": 1}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void chatAnswerIsSavedOnceUntilLastQuestion() throws Exception {
        long user = newUser();
        long sessionId = started(user, "CHAT");
        long first = currentQuestionId(user, sessionId);

        mvc.perform(submit(user, sessionId, first, text("답1")))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.questionId").value(first))
                .andExpect(jsonPath("$.inputType").value("TEXT"))
                .andExpect(jsonPath("$.isLastQuestion").value(false));
        verify(queue)
                .push(
                        argThat(
                                job ->
                                        job.getJobType() == AiJobType.SCORE_ANSWER
                                                && job.getSessionId() == sessionId
                                                && job.getAnswerId() != null));
        mvc.perform(submit(user, sessionId, first, text("다시")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ANSWER_ALREADY_SUBMITTED"));

        // 다음 질문은 에이전트가 말할 때(question.started) 생긴다. 여기서는 직접 만든다
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId + "/questions/current")))
                .andExpect(status().isAccepted());
        for (int seq = 2; seq <= 5; seq++) {
            ask(sessionId, seq);
            long question = currentQuestionId(user, sessionId);
            mvc.perform(submit(user, sessionId, question, text("답" + seq)))
                    .andExpect(status().isAccepted())
                    .andExpect(jsonPath("$.isLastQuestion").value(seq == 5));
        }
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(jsonPath("$.answeredCount").value(5))
                .andExpect(jsonPath("$.currentQuestion").doesNotExist());
    }

    @Test
    void answerValidationFollowsInterviewMode() throws Exception {
        long user = newUser();
        long chat = started(user, "CHAT");
        long question = currentQuestionId(user, chat);

        mvc.perform(submit(user, chat, question, Map.of("inputType", "VOICE", "content", "답")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("inputType"));
        mvc.perform(submit(user, chat, question, text("가".repeat(1_001))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("content"));
        mvc.perform(submit(user, chat, -1L, text("답")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("QUESTION_NOT_FOUND"));

        // 화상 답변은 결과 큐로 저장하므로 화상 면접에서 이 API를 부르면 400
        long video = started(user, "VIDEO");
        mvc.perform(submit(user, video, currentQuestionId(user, video), text("답")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("inputType"));
    }

    @Test
    void endWithAnswersStartsAnalysisAndLevelsUpOncePerDay() throws Exception {
        long user = newUser();
        long first = started(user, "CHAT");
        mvc.perform(submit(user, first, currentQuestionId(user, first), text("답")))
                .andExpect(status().isAccepted());

        mvc.perform(as(user, idempotent(post("/api/v1/interview-sessions/" + first + "/end"))))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("ANALYZING"))
                .andExpect(jsonPath("$.analysisStep").value("ORGANIZING_ANSWERS"))
                .andExpect(jsonPath("$.answeredCount").value(1))
                .andExpect(jsonPath("$.endedAt").exists())
                .andExpect(jsonPath("$.leveledUp").value(true));
        verify(queue)
                .push(
                        argThat(
                                job ->
                                        job.getJobType() == AiJobType.EVALUATE
                                                && job.getSessionId() == first));
        assertThat(practiceDates(user)).containsExactly(today());

        // 같은 날 두 번째 면접은 연습 기록이 늘지 않아 레벨업도 없다
        long second = started(user, "CHAT");
        mvc.perform(submit(user, second, currentQuestionId(user, second), text("답")))
                .andExpect(status().isAccepted());
        mvc.perform(as(user, idempotent(post("/api/v1/interview-sessions/" + second + "/end"))))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.leveledUp").value(false));
        assertThat(practiceDates(user)).containsExactly(today());

        mvc.perform(as(user, idempotent(post("/api/v1/interview-sessions/" + second + "/end"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
    }

    @Test
    void thirdDayInARowLevelsUp() throws Exception {
        long user = newUser();
        for (int daysAgo = 1; daysAgo <= 2; daysAgo++) {
            jdbc.update(
                    "INSERT INTO practice_logs (user_id, practice_date, created_at) VALUES (?, ?,"
                            + " now())",
                    user,
                    today().minusDays(daysAgo));
        }
        long sessionId = started(user, "CHAT");
        mvc.perform(submit(user, sessionId, currentQuestionId(user, sessionId), text("답")))
                .andExpect(status().isAccepted());

        mvc.perform(as(user, idempotent(post("/api/v1/interview-sessions/" + sessionId + "/end"))))
                .andExpect(jsonPath("$.leveledUp").value(true));
    }

    @Test
    void endWithoutAnswersIsAbortedWithoutPractice() throws Exception {
        long user = newUser();
        long sessionId = started(user, "CHAT");

        mvc.perform(as(user, idempotent(post("/api/v1/interview-sessions/" + sessionId + "/end"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ABORTED"))
                .andExpect(jsonPath("$.analysisStep").doesNotExist())
                .andExpect(jsonPath("$.leveledUp").value(false));
        assertThat(practiceDates(user)).isEmpty();
    }

    @Test
    void analysisFailsAfterTimeoutAndCanBeRetried() throws Exception {
        long user = newUser();
        long sessionId = started(user, "CHAT");
        mvc.perform(submit(user, sessionId, currentQuestionId(user, sessionId), text("답")))
                .andExpect(status().isAccepted());
        mvc.perform(as(user, idempotent(post("/api/v1/interview-sessions/" + sessionId + "/end"))))
                .andExpect(status().isAccepted());
        String retry = "/api/v1/interview-sessions/" + sessionId + "/analysis/retry";

        mvc.perform(as(user, post(retry)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        // 작업자가 10분 넘게 결과를 만들지 못했다
        runtimes.analysisStartedAt.put(sessionId, Instant.now().minusSeconds(601));
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FAILED"))
                .andExpect(jsonPath("$.analysisStep").doesNotExist());

        mvc.perform(as(user, post(retry)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("ANALYZING"))
                .andExpect(jsonPath("$.analysisStep").value("ORGANIZING_ANSWERS"));
        verify(queue, times(2))
                .push(
                        argThat(
                                job ->
                                        job.getJobType() == AiJobType.EVALUATE
                                                && job.getSessionId() == sessionId));
    }

    // 플랜까지 준비해 시작한 면접
    private long started(long userId, String mode) throws Exception {
        String body =
                mvc.perform(createRequest(userId, newApplication(userId), mode))
                        .andExpect(status().isCreated())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long sessionId = json.readTree(body).path("id").asLong();
        planReady(sessionId);
        mvc.perform(
                        as(
                                userId,
                                idempotent(
                                        post(
                                                "/api/v1/interview-sessions/"
                                                        + sessionId
                                                        + "/start"))))
                .andExpect(status().isOk());
        return sessionId;
    }

    private long currentQuestionId(long userId, long sessionId) throws Exception {
        String body =
                mvc.perform(
                                as(
                                        userId,
                                        get(
                                                "/api/v1/interview-sessions/"
                                                        + sessionId
                                                        + "/questions/current")))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return json.readTree(body).path("id").asLong();
    }

    private MockHttpServletRequestBuilder submit(
            long userId, long sessionId, long questionId, Map<String, Object> body) {
        return as(
                        userId,
                        idempotent(
                                post(
                                        "/api/v1/interview-sessions/"
                                                + sessionId
                                                + "/questions/"
                                                + questionId
                                                + "/answer")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(body));
    }

    private static Map<String, Object> text(String content) {
        return Map.of("inputType", "TEXT", "content", content);
    }

    private List<LocalDate> practiceDates(long userId) {
        return jdbc.queryForList(
                "SELECT practice_date FROM practice_logs WHERE user_id = ?",
                LocalDate.class,
                userId);
    }

    private static LocalDate today() {
        return LocalDate.now(ZoneId.of("Asia/Seoul"));
    }

    private long create(long userId, long applicationId) throws Exception {
        String body =
                mvc.perform(createRequest(userId, applicationId))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.status").value("READY"))
                        .andExpect(jsonPath("$.planStatus").value("GENERATING"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return json.readTree(body).path("id").asLong();
    }

    private MockHttpServletRequestBuilder createRequest(long userId, long applicationId) {
        return createRequest(userId, applicationId, "VIDEO");
    }

    private MockHttpServletRequestBuilder createRequest(
            long userId, long applicationId, String mode) {
        return as(userId, idempotent(post("/api/v1/interview-sessions")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        json.writeValueAsString(
                                Map.of(
                                        "applicationId", applicationId,
                                        "persona", "DEVIL",
                                        "mode", mode)));
    }

    // AI 작업자가 플랜을 만든 것처럼 플랜 행과 READY를 남긴다
    private void planReady(long sessionId) {
        StringBuilder questionsJson = new StringBuilder("[");
        for (int seq = 1; seq <= 5; seq++) {
            questionsJson
                    .append(seq == 1 ? "" : ",")
                    .append("{\"seq\":")
                    .append(seq)
                    .append(",\"content\":\"질문")
                    .append(seq)
                    .append("\",\"criteria\":\"기준\",\"claimId\":\"c1\"}");
        }
        jdbc.update(
                "INSERT INTO interview_plans (session_id, claims, questions, prompt_version,"
                        + " model_version, created_at) VALUES (?, CAST('[]' AS jsonb), CAST(? AS"
                        + " jsonb), 'plan-v1', 'gms-test', now())",
                sessionId,
                questionsJson.append("]").toString());
        runtimes.values.put(sessionId, new SessionRuntime(PlanStatus.READY, null, null, 0));
    }

    // 5.7이 할 일(다음 질문 내기·답변 저장)을 직접 한다
    private void ask(long sessionId, int seq) {
        InterviewSession session = sessions.findById(sessionId).orElseThrow();
        questions.saveAndFlush(new InterviewQuestion(session, seq, "질문" + seq));
    }

    private void answer(long sessionId, int seq) {
        InterviewQuestion question =
                questions.findFirstBySessionIdOrderBySeqDesc(sessionId).orElseThrow();
        assertThat(question.getSeq()).isEqualTo(seq);
        answers.saveAndFlush(new Answer(question, InputType.TEXT, "답" + seq));
    }

    private long newUser() {
        long id =
                users.saveAndFlush(
                                new User(
                                        "interview-it-" + UUID.randomUUID() + "@example.com",
                                        "hash",
                                        "면접 검증"))
                        .getId();
        userIds.add(id);
        return id;
    }

    private long newApplication(long userId) {
        return applications
                .saveAndFlush(
                        new Application(users.getReferenceById(userId), "○○전자", "백엔드 개발자", "저는…"))
                .getId();
    }

    private static MockHttpServletRequestBuilder idempotent(MockHttpServletRequestBuilder request) {
        return request.header("Idempotency-Key", UUID.randomUUID().toString());
    }

    private static MockHttpServletRequestBuilder as(
            long userId, MockHttpServletRequestBuilder request) {
        return request.with(jwt().jwt(token -> token.subject(Long.toString(userId))));
    }

    @TestConfiguration
    static class RuntimeConfig {
        @Bean
        @Primary
        InMemoryRuntimeStore inMemoryRuntimeStore() {
            return new InMemoryRuntimeStore();
        }
    }

    /** RedisSessionRuntimeStore 대신 쓰는 메모리 저장소 */
    static class InMemoryRuntimeStore implements SessionRuntimeStore {
        final Map<Long, SessionRuntime> values = new ConcurrentHashMap<>();
        final Map<Long, Instant> planStartedAt = new ConcurrentHashMap<>();
        final Map<Long, Instant> analysisStartedAt = new ConcurrentHashMap<>();

        @Override
        public Optional<SessionRuntime> find(long sessionId) {
            return Optional.ofNullable(values.get(sessionId));
        }

        @Override
        public void startPlan(long sessionId, Instant now) {
            values.put(sessionId, SessionRuntime.generating());
            planStartedAt.put(sessionId, now);
        }

        @Override
        public Optional<Instant> findPlanStartedAt(long sessionId) {
            return Optional.ofNullable(planStartedAt.get(sessionId));
        }

        @Override
        public void failPlanIfGenerating(long sessionId) {
            values.computeIfPresent(
                    sessionId,
                    (id, runtime) ->
                            runtime.planStatus() == PlanStatus.GENERATING
                                    ? new SessionRuntime(PlanStatus.FAILED, null, null, 0)
                                    : runtime);
        }

        @Override
        public void startAnalysis(long sessionId, Instant now) {
            values.computeIfPresent(
                    sessionId,
                    (id, runtime) ->
                            new SessionRuntime(
                                    runtime.planStatus(),
                                    runtime.planProgress(),
                                    AnalysisStep.ORGANIZING_ANSWERS,
                                    runtime.pausedSeconds()));
            analysisStartedAt.put(sessionId, now);
        }

        @Override
        public Optional<Instant> findAnalysisStartedAt(long sessionId) {
            return Optional.ofNullable(analysisStartedAt.get(sessionId));
        }
    }
}
