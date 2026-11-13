package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.domain.ApplicationClaim;
import com.ssafy.a301.application.repository.ApplicationClaimRepository;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.idempotency.IdempotencyStore;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanClaim;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.service.InterviewCapacity;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
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
@Import(InMemorySessionRuntimeStore.Config.class)
class InterviewSessionIntegrationTest {
    // 회사 카드 매칭 확인용. 실제 DART 고유번호와 겹치지 않게 9로 시작한다
    private static final String CARD_CORP_CODE = "99000401";

    @Autowired private MockMvc mvc;
    @Autowired private UserRepository users;
    @Autowired private ApplicationRepository applications;
    @Autowired private ApplicationClaimRepository applicationClaims;
    @Autowired private InterviewSessionRepository sessions;
    @Autowired private InterviewQuestionRepository questions;
    @Autowired private AnswerRepository answers;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private InMemorySessionRuntimeStore runtimes;
    @MockitoBean private AiJobQueue queue;
    @MockitoBean private IdempotencyStore idempotency;
    @MockitoBean private InterviewRoom rooms;
    // 상한은 InterviewCapacityTest가 실제 DB로 확인한다. 여기서는 DB에 남은 다른 면접 수에 흔들리지 않게 바꾼다
    @MockitoBean private InterviewCapacity interviewCapacity;
    // 오늘 기사라 버리지 않는 최근 이슈(AI 명세 2장 폐기)
    private static final Map<String, Object> RECENT =
            Map.of("section", "recent", "summary", "이슈", "published", today().toString());
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<Long> userIds = new ArrayList<>();

    @BeforeEach
    void setUp() {
        runtimes.clear();
        when(rooms.issueAccess(anyLong(), anyBoolean()))
                .thenAnswer(
                        call ->
                                new RoomResponse(
                                        "wss://rtc.test",
                                        "token-" + call.getArgument(0),
                                        OffsetDateTime.now().plusMinutes(10)));
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
            jdbc.update("DELETE FROM recordings WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM speech_metrics WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM practice_logs WHERE user_id = ?", id);
            jdbc.update("DELETE FROM interview_sessions WHERE user_id = ?", id);
            String applicationsOfUser = "SELECT id FROM applications WHERE user_id = " + id;
            for (String table :
                    List.of("ai_job_outbox", "application_claims", "question_pool_items")) {
                jdbc.update(
                        "DELETE FROM "
                                + table
                                + " WHERE application_id IN ("
                                + applicationsOfUser
                                + ")");
            }
            jdbc.update("DELETE FROM applications WHERE user_id = ?", id);
            jdbc.update("DELETE FROM users WHERE id = ?", id);
        }
        // 면접을 지운 뒤에 지운다(면접이 가리키는 카드는 FK가 막는다)
        jdbc.update(
                "DELETE FROM company_cards WHERE company_id IN"
                        + " (SELECT id FROM companies WHERE corp_code = ?)",
                CARD_CORP_CODE);
        jdbc.update(
                "DELETE FROM company_aliases WHERE company_id IN"
                        + " (SELECT id FROM companies WHERE corp_code = ?)",
                CARD_CORP_CODE);
        jdbc.update("DELETE FROM companies WHERE corp_code = ?", CARD_CORP_CODE);
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
                                        "PLAN".equals(job.get("jobType"))
                                                && Long.valueOf(sessionId)
                                                        .equals(job.get("sessionId"))));
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.companyName").value("○○전자"))
                .andExpect(jsonPath("$.status").value("READY"))
                .andExpect(jsonPath("$.planStatus").value("GENERATING"))
                .andExpect(jsonPath("$.planProgress").value(0))
                .andExpect(jsonPath("$.currentQuestion").doesNotExist())
                .andExpect(jsonPath("$.leveledUp").doesNotExist());
        // 면접에 쓴 지원서도 지울 수 있고, 지워도(소프트 삭제) 그 지원서로 만든 면접은 그대로 조회된다
        mvc.perform(as(user, delete("/api/v1/applications/" + application)))
                .andExpect(status().isNoContent());
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.companyName").value("○○전자"));
    }

    // 기준: AI 명세 2장 STEP 01 · BE 설계 5.1(주장이 없는 지원서면 질문 생성 대신 주장 추출을 다시 요청한다. 추출 중인지는 따로 관리하지 않는다)
    @Test
    void createWithoutClaimsAsksClaimExtractionInsteadOfPlan() throws Exception {
        long user = newUser();
        long application = newApplicationWithoutClaims(user, "○○전자");

        long sessionId = create(user, application);

        assertThat(runtimes.find(sessionId))
                .contains(new SessionRuntime(PlanStatus.GENERATING, 0, null, 0));
        verify(queue)
                .push(
                        argThat(
                                job ->
                                        "EXTRACT_CLAIMS".equals(job.get("jobType"))
                                                && Long.valueOf(application)
                                                        .equals(job.get("applicationId"))
                                                && !job.containsKey("sessionId")));
        verify(queue, never()).push(argThat(job -> "PLAN".equals(job.get("jobType"))));
    }

    // 기준: AI 명세 1.3 persona(오리 면접관 DUCK도 면접을 만들 때 고르고 PLAN에 담는다)
    @Test
    void createAcceptsDuckPersonaAndSendsItWithPlan() throws Exception {
        long user = newUser();

        String body =
                mvc.perform(createRequest(user, newApplication(user), "CHAT", "DUCK"))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.persona").value("DUCK"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long sessionId = json.readTree(body).path("id").asLong();

        verify(queue)
                .push(
                        argThat(
                                job ->
                                        Long.valueOf(sessionId).equals(job.get("sessionId"))
                                                && "DUCK".equals(job.get("persona"))));
    }

    // 기준: ERD 회사카드(면접을 만들 때 지원서 회사명으로 찾은 최신 카드를 면접에 남기고 PLAN에 담는다), AI 명세 8장
    @Test
    void createKeepsCompanyCardAndSendsItWithPlan() throws Exception {
        long cardId = companyCard("테스트에이삼공일", "{\"corp_code\": \"" + CARD_CORP_CODE + "\"}");
        long user = newUser();
        long withCard = newApplication(user, "(주) 테스트 에이삼공일");
        long withoutCard = newApplication(user, "카드없는회사에이삼공일");

        long sessionId = create(user, withCard);
        long noCardSessionId = create(user, withoutCard);

        assertThat(companyCardOf(sessionId)).isEqualTo(cardId);
        assertThat(companyCardOf(noCardSessionId)).isNull();
        verify(queue)
                .push(
                        argThat(
                                job ->
                                        Long.valueOf(sessionId).equals(job.get("sessionId"))
                                                && Map.of("corp_code", CARD_CORP_CODE)
                                                        .equals(job.get("companyCard"))));
        verify(queue)
                .push(
                        argThat(
                                job ->
                                        Long.valueOf(noCardSessionId).equals(job.get("sessionId"))
                                                && !job.containsKey("companyCard")));
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
                    get("/api/v1/interview-sessions/" + sessionId + "/questions/current"),
                    post("/api/v1/interview-sessions/" + sessionId + "/room-token")
                }) {
            mvc.perform(as(other, request))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        }
    }

    // 기준: AI 명세 2장 출제 자리 배정 · API 명세 5.1 · 6.1(보관함 질문이 5개 이상이면 AI 작업 없이 바로 준비하고, 배정 정보에 연결 회사 항목을
    // 담는다)
    @Test
    @SuppressWarnings("unchecked")
    void createWithEnoughPoolQuestionsIsReadyWithoutAskingAi() throws Exception {
        long user = newUser();
        long application = newApplication(user);
        poolQuestions(application, 5);

        String body =
                mvc.perform(createRequest(user, application))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.planStatus").value("READY"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long sessionId = json.readTree(body).path("id").asLong();

        assertThat(runtimes.find(sessionId).orElseThrow().planStatus()).isEqualTo(PlanStatus.READY);
        verify(queue, never()).push(any());
        mvc.perform(
                        as(
                                user,
                                idempotent(
                                        post(
                                                "/api/v1/interview-sessions/"
                                                        + sessionId
                                                        + "/start"))))
                .andExpect(status().isOk());
        ArgumentCaptor<Map<String, Object>> assignment = ArgumentCaptor.forClass(Map.class);
        verify(rooms).open(eq(sessionId), eq(true), assignment.capture(), any());
        List<Map<String, Object>> assigned =
                (List<Map<String, Object>>) assignment.getValue().get("questions");
        assertThat(assigned)
                .extracting(question -> question.get("content"))
                .containsExactly("보관1", "보관3", "보관2", "보관4", "보관5");
        assertThat(assigned.get(2)).containsEntry("companyItem", RECENT);
        assertThat(assigned.get(0)).containsEntry("companyItem", null);
    }

    // 기준: API 명세 5.3(질문 보관함은 5.1과 같이 쓴다)
    @Test
    void retryWithEnoughPoolQuestionsIsReadyWithoutAskingAi() throws Exception {
        long user = newUser();
        long application = newApplication(user);
        long sessionId = create(user, application);
        runtimes.values.put(sessionId, new SessionRuntime(PlanStatus.FAILED, null, null, 0));
        poolQuestions(application, 5);

        mvc.perform(as(user, post("/api/v1/interview-sessions/" + sessionId + "/plan/retry")))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.planStatus").value("READY"));

        assertThat(runtimes.find(sessionId).orElseThrow().planStatus()).isEqualTo(PlanStatus.READY);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM interview_plans WHERE session_id = ?",
                                Integer.class,
                                sessionId))
                .isEqualTo(1);
        // 면접을 만들 때 보낸 작업 하나뿐이다
        verify(queue, times(1)).push(any());
    }

    // 기준: AI 명세 2장 폐기(보관함 질문 수를 세기 전에 기사 날짜로부터 30일이 지난 최근 이슈 질문을 버린다)
    @Test
    void createDiscardsOldRecentIssueQuestionBeforeCounting() throws Exception {
        long user = newUser();
        long application = newApplication(user);
        poolQuestions(application, 4);
        poolQuestion(
                application,
                "지난 이슈",
                Map.of(
                        "section",
                        "recent",
                        "summary",
                        "이슈",
                        "published",
                        today().minusDays(31).toString()));

        long sessionId = create(user, application);

        verify(queue)
                .push(
                        argThat(
                                job ->
                                        "PLAN".equals(job.get("jobType"))
                                                && Long.valueOf(sessionId)
                                                        .equals(job.get("sessionId"))));
        assertThat(
                        jdbc.queryForList(
                                "SELECT content FROM question_pool_items WHERE application_id = ?"
                                        + " ORDER BY id",
                                String.class,
                                application))
                .containsExactly("보관1", "보관2", "보관3", "보관4");
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
                                        "PLAN".equals(job.get("jobType"))
                                                && Long.valueOf(sessionId)
                                                        .equals(job.get("sessionId"))));
    }

    @Test
    @SuppressWarnings("unchecked")
    void startOpensRoomWithPlanAndGivesRoomAccess() throws Exception {
        long user = newUser();
        long sessionId = create(user, newApplication(user));
        String start = "/api/v1/interview-sessions/" + sessionId + "/start";

        mvc.perform(as(user, idempotent(post(start))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PLAN_NOT_READY"));
        verify(rooms, never()).open(anyLong(), anyBoolean(), any(), any());

        planReady(sessionId);
        mvc.perform(as(user, idempotent(post(start))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.planStatus").value("READY"))
                .andExpect(jsonPath("$.currentQuestion").doesNotExist())
                .andExpect(jsonPath("$.room.url").value("wss://rtc.test"))
                .andExpect(jsonPath("$.room.token").value("token-" + sessionId))
                .andExpect(jsonPath("$.room.expiresAt").exists())
                .andExpect(jsonPath("$.answeredCount").value(0))
                .andExpect(jsonPath("$.startedAt").exists());

        // 화상 면접: 녹화를 켜고 질문 5개를 1번부터 배정한다
        ArgumentCaptor<Map<String, Object>> assignment = ArgumentCaptor.forClass(Map.class);
        verify(rooms).open(eq(sessionId), eq(true), assignment.capture(), any());
        assertThat(assignment.getValue())
                .containsEntry("sessionId", sessionId)
                .containsEntry("mode", "VIDEO")
                .containsEntry("persona", "DEVIL")
                .containsEntry("currentSeq", 1);
        assertThat((List<Map<String, Object>>) assignment.getValue().get("questions"))
                .extracting(question -> question.get("seq"))
                .containsExactly(1, 2, 3, 4, 5);
        // 질문 행은 에이전트가 질문을 말할 때 생긴다(API 명세 5.4)
        assertThat(questions.findFirstBySessionIdOrderBySeqDesc(sessionId)).isEmpty();
        mvc.perform(as(user, get(start.replace("/start", ""))))
                .andExpect(jsonPath("$.room").doesNotExist());

        mvc.perform(as(user, idempotent(post(start))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
    }

    @Test
    void startStaysReadyWhenRoomCannotOpen() throws Exception {
        long user = newUser();
        long sessionId = create(user, newApplication(user));
        planReady(sessionId);
        String start = "/api/v1/interview-sessions/" + sessionId + "/start";
        doThrow(new ApiException(ErrorCode.ROOM_UNAVAILABLE))
                .doNothing()
                .when(rooms)
                .open(eq(sessionId), anyBoolean(), any(), any());

        mvc.perform(as(user, idempotent(post(start))))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("ROOM_UNAVAILABLE"));
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(jsonPath("$.status").value("READY"));

        // 다시 누르면 시작한다
        mvc.perform(as(user, idempotent(post(start))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"));
    }

    @Test
    void videoStartIsRejectedWhenCapacityIsFull() throws Exception {
        long user = newUser();
        long sessionId = create(user, newApplication(user));
        planReady(sessionId);
        String start = "/api/v1/interview-sessions/" + sessionId + "/start";
        doThrow(new ApiException(ErrorCode.INTERVIEW_CAPACITY_FULL))
                .when(interviewCapacity)
                .reserveVideo(any());

        mvc.perform(as(user, idempotent(post(start))))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("INTERVIEW_CAPACITY_FULL"));
        // 면접방을 열지 않고 상태도 그대로라 잠시 후 다시 시작할 수 있다
        verify(rooms, never()).open(anyLong(), anyBoolean(), any(), any());
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(jsonPath("$.status").value("READY"));
    }

    // 채팅은 STT를 쓰지 않으므로 상한을 보지 않는다
    @Test
    void chatStartDoesNotCheckCapacity() throws Exception {
        long user = newUser();
        doThrow(new ApiException(ErrorCode.INTERVIEW_CAPACITY_FULL))
                .when(interviewCapacity)
                .reserveVideo(any());

        started(user, "CHAT");

        verify(interviewCapacity, never()).reserveVideo(any());
    }

    @Test
    void startFailedCanOnlyBeStartedAgain() throws Exception {
        long user = newUser();
        long sessionId = create(user, newApplication(user));
        planReady(sessionId);
        String base = "/api/v1/interview-sessions/" + sessionId;
        mvc.perform(as(user, idempotent(post(base + "/start")))).andExpect(status().isOk());
        // 에이전트가 배정을 거절했다(assignment.rejected, AiResultServiceTest)
        jdbc.update(
                "UPDATE interview_sessions SET status = 'START_FAILED' WHERE id = ?", sessionId);

        mvc.perform(as(user, get(base)))
                .andExpect(jsonPath("$.status").value("START_FAILED"))
                .andExpect(jsonPath("$.planStatus").value("READY"));
        for (MockHttpServletRequestBuilder request :
                new MockHttpServletRequestBuilder[] {
                    get(base + "/questions/current"),
                    post(base + "/room-token"),
                    idempotent(post(base + "/end"))
                }) {
            mvc.perform(as(user, request))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));
        }

        mvc.perform(as(user, idempotent(post(base + "/start"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.room.token").value("token-" + sessionId));
        // 다시 시작하면 시작 시각이 새로 기록돼 이전 시도와 다른 위치에 녹화한다
        ArgumentCaptor<OffsetDateTime> startedAt = ArgumentCaptor.forClass(OffsetDateTime.class);
        verify(rooms, times(2)).open(eq(sessionId), eq(true), any(), startedAt.capture());
        assertThat(startedAt.getAllValues().get(1)).isAfter(startedAt.getAllValues().get(0));
    }

    @Test
    void othersCannotAnswerEndOrRetryAnalysis() throws Exception {
        long owner = newUser();
        long other = newUser();
        long sessionId = started(owner, "CHAT");
        long questionId = currentQuestionId(owner, sessionId);
        String end = "/api/v1/interview-sessions/" + sessionId + "/end";
        String retry = "/api/v1/interview-sessions/" + sessionId + "/analysis/retry";

        mvc.perform(submit(other, sessionId, questionId, text("남의 답")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        mvc.perform(as(other, idempotent(post(end))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        assertThat(answers.countByQuestionSessionId(sessionId)).isZero();
        assertThat(sessions.findById(sessionId).orElseThrow().getStatus())
                .isEqualTo(SessionStatus.IN_PROGRESS);

        mvc.perform(submit(owner, sessionId, questionId, text("답")))
                .andExpect(status().isAccepted());
        mvc.perform(as(owner, idempotent(post(end)))).andExpect(status().isAccepted());
        runtimes.analysisStartedAt.put(sessionId, Instant.now().minusSeconds(601));
        mvc.perform(as(owner, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(jsonPath("$.status").value("FAILED"));

        mvc.perform(as(other, post(retry)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        assertThat(sessions.findById(sessionId).orElseThrow().getStatus())
                .isEqualTo(SessionStatus.FAILED);
    }

    @Test
    void answerAndEndAtTheSameTimeLeaveConsistentResult() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 3; round++) {
                long user = newUser();
                long sessionId = started(user, "CHAT");
                long questionId = currentQuestionId(user, sessionId);
                CountDownLatch ready = new CountDownLatch(1);
                Future<Integer> answer =
                        pool.submit(
                                () -> {
                                    ready.await();
                                    return mvc.perform(
                                                    submit(user, sessionId, questionId, text("답")))
                                            .andReturn()
                                            .getResponse()
                                            .getStatus();
                                });
                Future<Integer> end =
                        pool.submit(
                                () -> {
                                    ready.await();
                                    return mvc.perform(
                                                    as(
                                                            user,
                                                            idempotent(
                                                                    post(
                                                                            "/api/v1/interview-sessions/"
                                                                                    + sessionId
                                                                                    + "/end"))))
                                            .andReturn()
                                            .getResponse()
                                            .getStatus();
                                });
                ready.countDown();
                int answerStatus = answer.get(10, TimeUnit.SECONDS);
                int endStatus = end.get(10, TimeUnit.SECONDS);

                // 면접 행 잠금으로 둘 중 하나가 먼저 끝난다. 어느 순서든 답변 수와 상태가 맞아야 한다
                SessionStatus status = sessions.findById(sessionId).orElseThrow().getStatus();
                int answered = answers.countByQuestionSessionId(sessionId);
                if (answerStatus == 202) {
                    assertThat(endStatus).isEqualTo(202);
                    assertThat(status).isEqualTo(SessionStatus.ANALYZING);
                    assertThat(answered).isEqualTo(1);
                    assertThat(practiceDates(user)).hasSize(1);
                } else {
                    assertThat(answerStatus).isEqualTo(409);
                    assertThat(endStatus).isEqualTo(200);
                    assertThat(status).isEqualTo(SessionStatus.ABORTED);
                    assertThat(answered).isZero();
                    assertThat(practiceDates(user)).isEmpty();
                }
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void startClosesOpenedRoomWhenItFailsAfterOpening() throws Exception {
        long user = newUser();
        long sessionId = create(user, newApplication(user));
        planReady(sessionId);
        // 방은 열었는데 입장 정보를 만들다 실패해 시작이 되돌려진다
        when(rooms.issueAccess(eq(sessionId), anyBoolean()))
                .thenThrow(new IllegalStateException("입장 토큰 서명 실패"));

        mvc.perform(
                        as(
                                user,
                                idempotent(
                                        post(
                                                "/api/v1/interview-sessions/"
                                                        + sessionId
                                                        + "/start"))))
                .andExpect(status().isInternalServerError());

        verify(rooms).open(eq(sessionId), anyBoolean(), any(), any());
        verify(rooms).close(sessionId);
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(jsonPath("$.status").value("READY"));
    }

    @Test
    void roomTokenOnlyWhileInProgress() throws Exception {
        long user = newUser();
        long sessionId = create(user, newApplication(user));
        String token = "/api/v1/interview-sessions/" + sessionId + "/room-token";

        mvc.perform(as(user, post(token)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        long chat = started(user, "CHAT");
        mvc.perform(as(user, post("/api/v1/interview-sessions/" + chat + "/room-token")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("wss://rtc.test"))
                .andExpect(jsonPath("$.token").value("token-" + chat))
                .andExpect(jsonPath("$.expiresAt").exists());
        // 채팅은 송출 권한 없이 받는다
        verify(rooms, atLeastOnce()).issueAccess(chat, false);
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
        // 에이전트가 1번 질문을 말하기 전
        mvc.perform(as(user, get(current)))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.code").value("QUESTION_GENERATING"));
        ask(sessionId, 1);
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
                                        "SCORE_ANSWER".equals(job.get("jobType"))
                                                && Long.valueOf(sessionId)
                                                        .equals(job.get("sessionId"))
                                                && job.get("answerId") != null));
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
                                        "EVALUATE".equals(job.get("jobType"))
                                                && Long.valueOf(first)
                                                        .equals(job.get("sessionId"))));
        assertThat(practiceDates(user)).containsExactly(today());
        // 커밋 뒤 면접방을 지운다
        verify(rooms).close(first);
        // 채팅 면접은 녹화가 없다
        verify(queue, never()).push(argThat(job -> "MERGE_RECORDING".equals(job.get("jobType"))));
        assertThat(recordingStatuses(first)).isEmpty();

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

    // 2.7: 진행 중인 면접이 있으면 탈퇴를 막는다. 시작한 지 2시간이 지나 진행 중으로 남은 면접은 떠난 면접으로 보고 막지 않는다
    @Test
    void withdrawingDuringInterviewIsRejectedButLeftInterviewDoesNotBlock() throws Exception {
        // 비밀번호 없는(소셜) 회원은 비밀번호 없이 탈퇴한다
        long user =
                users.saveAndFlush(
                                new User(
                                        "interview-it-" + UUID.randomUUID() + "@example.com",
                                        null,
                                        "탈퇴 검증"))
                        .getId();
        userIds.add(user);
        long sessionId = started(user, "CHAT");
        MockHttpServletRequestBuilder withdraw =
                post("/api/v1/users/me").contentType(MediaType.APPLICATION_JSON).content("{}");

        mvc.perform(as(user, withdraw))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INTERVIEW_IN_PROGRESS"));

        jdbc.update(
                "UPDATE interview_sessions SET started_at = now() - interval '121 minutes' WHERE id"
                        + " = ?",
                sessionId);
        mvc.perform(as(user, withdraw)).andExpect(status().isNoContent());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT deleted_at IS NOT NULL FROM users WHERE id = ?",
                                Boolean.class,
                                user))
                .isTrue();
    }

    @Test
    void endVideoWithAnswersAlsoMergesRecording() throws Exception {
        long user = newUser();
        long sessionId = started(user, "VIDEO");
        answer(sessionId, 1);

        mvc.perform(as(user, idempotent(post("/api/v1/interview-sessions/" + sessionId + "/end"))))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("ANALYZING"));

        // 합치기 작업은 방을 열 때 정한 녹화 위치를 그대로 쓴다
        ArgumentCaptor<OffsetDateTime> startedAt = ArgumentCaptor.forClass(OffsetDateTime.class);
        verify(rooms).open(eq(sessionId), eq(true), any(), startedAt.capture());
        // 시작 시각을 밀리초로 잘라 저장하므로 DB에서 읽어도 같은 위치가 된다
        assertThat(
                        jdbc.queryForObject(
                                "SELECT started_at FROM interview_sessions WHERE id = ?",
                                OffsetDateTime.class,
                                sessionId))
                .isAtSameInstantAs(startedAt.getValue());
        String rawPrefix =
                "recordings/raw/"
                        + sessionId
                        + "/"
                        + startedAt.getValue().toInstant().toEpochMilli()
                        + "/";
        verify(queue)
                .push(
                        argThat(
                                job ->
                                        "MERGE_RECORDING".equals(job.get("jobType"))
                                                && rawPrefix.equals(job.get("rawPrefix"))
                                                && ("recordings/" + sessionId + ".mp4")
                                                        .equals(job.get("objectKey"))));
        // 다시보기가 합치는 중으로 응답하도록 합친 녹화 행을 MERGING으로 만든다
        assertThat(recordingStatuses(sessionId)).containsExactly("MERGING");
    }

    @Test
    void endVideoWithoutAnswersDoesNotMergeRecording() throws Exception {
        long user = newUser();
        long sessionId = started(user, "VIDEO");

        mvc.perform(as(user, idempotent(post("/api/v1/interview-sessions/" + sessionId + "/end"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ABORTED"));

        verify(queue, never()).push(argThat(job -> "MERGE_RECORDING".equals(job.get("jobType"))));
        assertThat(recordingStatuses(sessionId)).isEmpty();
    }

    // 기준: API 명세 5.8 본문 gazeRatio(화면이 브라우저에서 잰 시선 비율, 결과가 나오는 화상 면접만 저장)
    @Test
    void endVideoWithGazeRatioSavesItBeforeResult() throws Exception {
        long user = newUser();
        long sessionId = started(user, "VIDEO");
        answer(sessionId, 1);

        mvc.perform(end(user, sessionId, "{\"gazeRatio\": 72.456}"))
                .andExpect(status().isAccepted());

        // 말하기 지표는 결과가 나올 때 채운다
        assertThat(
                        jdbc.queryForMap(
                                "SELECT gaze_ratio, filler_per_min FROM speech_metrics WHERE"
                                        + " session_id = ?",
                                sessionId))
                .containsEntry("gaze_ratio", new BigDecimal("72.46"))
                .containsEntry("filler_per_min", null);
    }

    @Test
    void gazeRatioIsIgnoredWithoutVideoResult() throws Exception {
        long user = newUser();
        long chat = started(user, "CHAT");
        mvc.perform(submit(user, chat, currentQuestionId(user, chat), text("답")))
                .andExpect(status().isAccepted());
        long unanswered = started(user, "VIDEO");

        mvc.perform(end(user, chat, "{\"gazeRatio\": 50}")).andExpect(status().isAccepted());
        mvc.perform(end(user, unanswered, "{\"gazeRatio\": 50}")).andExpect(status().isOk());

        assertThat(speechMetricCount(chat) + speechMetricCount(unanswered)).isZero();
    }

    @Test
    void gazeRatioOutOfRangeIsRejected() throws Exception {
        long user = newUser();
        long sessionId = started(user, "VIDEO");
        answer(sessionId, 1);

        for (String body : List.of("{\"gazeRatio\": 100.01}", "{\"gazeRatio\": -1}")) {
            mvc.perform(end(user, sessionId, body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        }
        assertThat(sessions.findById(sessionId).orElseThrow().getStatus())
                .isEqualTo(SessionStatus.IN_PROGRESS);
    }

    private MockHttpServletRequestBuilder end(long userId, long sessionId, String body) {
        return as(userId, idempotent(post("/api/v1/interview-sessions/" + sessionId + "/end")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    private int speechMetricCount(long sessionId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM speech_metrics WHERE session_id = ?",
                Integer.class,
                sessionId);
    }

    private List<String> recordingStatuses(long sessionId) {
        return jdbc.queryForList(
                "SELECT status FROM recordings WHERE session_id = ?", String.class, sessionId);
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
                .andExpect(jsonPath("$.room").doesNotExist())
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
                                        "EVALUATE".equals(job.get("jobType"))
                                                && Long.valueOf(sessionId)
                                                        .equals(job.get("sessionId"))));
    }

    @Test
    void analysisWithLostRedisStateFailsByEndedAtAndCanBeRetried() throws Exception {
        long user = newUser();
        long sessionId = started(user, "CHAT");
        mvc.perform(submit(user, sessionId, currentQuestionId(user, sessionId), text("답")))
                .andExpect(status().isAccepted());
        mvc.perform(as(user, idempotent(post("/api/v1/interview-sessions/" + sessionId + "/end"))))
                .andExpect(status().isAccepted());

        // Redis 상태가 사라졌고(TTL 만료·재시작) 작업도 잃어 11분째 결과가 없다
        runtimes.analysisStartedAt.remove(sessionId);
        jdbc.update(
                "UPDATE interview_sessions SET ended_at = now() - interval '11 minutes' WHERE id ="
                        + " ?",
                sessionId);
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("FAILED"));

        // 5.9로 다시 만들 수 있다. 새 시작 시각(Redis)으로 다시 기다린다
        mvc.perform(as(user, post("/api/v1/interview-sessions/" + sessionId + "/analysis/retry")))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("ANALYZING"));
        mvc.perform(as(user, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(jsonPath("$.status").value("ANALYZING"));
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
        // 에이전트가 1번 질문을 말한 것처럼 질문 행을 만든다(question.started)
        ask(sessionId, 1);
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
        return createRequest(userId, applicationId, mode, "DEVIL");
    }

    private MockHttpServletRequestBuilder createRequest(
            long userId, long applicationId, String mode, String persona) {
        return as(userId, idempotent(post("/api/v1/interview-sessions")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        json.writeValueAsString(
                                Map.of(
                                        "applicationId", applicationId,
                                        "persona", persona,
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
        questions.saveAndFlush(
                new InterviewQuestion(
                        session, seq, "질문" + seq, "기준" + seq, null, null, OffsetDateTime.now()));
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
        return newApplication(userId, "○○전자");
    }

    // 주장을 추출해 둔 지원서. 개인 면접을 만들면 바로 질문 생성(PLAN)을 요청한다(AI 명세 2장)
    private long newApplication(long userId, String companyName) {
        long applicationId = newApplicationWithoutClaims(userId, companyName);
        applicationClaims.saveAndFlush(
                new ApplicationClaim(
                        applications.getReferenceById(applicationId),
                        new PlanClaim("c1", "주장", "EXPERIENCE", 1, List.of("실행·성과")),
                        "extract-claims-v1",
                        "model"));
        return applicationId;
    }

    // 생성한 개인 면접 질문을 보관한 것처럼 면접관 DEVIL의 보관함에 넣는다. 2번째만 회사 정보와 연결한다
    private void poolQuestions(long applicationId, int count) {
        for (int i = 1; i <= count; i++) {
            poolQuestion(applicationId, "보관" + i, i == 2 ? RECENT : null);
        }
    }

    private void poolQuestion(long applicationId, String content, Map<String, Object> companyItem) {
        jdbc.update(
                "INSERT INTO question_pool_items (application_id, persona, content, criteria,"
                        + " claim_id, company_item, prompt_version, model_version, created_at)"
                        + " VALUES (?, 'DEVIL', ?, '기준', 'c1', CAST(? AS jsonb), 'plan-v8',"
                        + " 'gms-test', now())",
                applicationId,
                content,
                companyItem == null ? null : json.writeValueAsString(companyItem));
    }

    // 주장 추출 결과를 아직 받지 못한 지원서
    private long newApplicationWithoutClaims(long userId, String companyName) {
        return applications
                .saveAndFlush(
                        new Application(users.getReferenceById(userId), companyName, "백엔드 개발자"))
                .getId();
    }

    // 적재(CompanyCardImporter)가 넣은 것처럼 회사 · 별칭 · 최신 카드를 넣고 카드 id를 준다
    private long companyCard(String alias, String cardJson) {
        long companyId =
                jdbc.queryForObject(
                        "INSERT INTO companies (corp_code, name, is_listed, created_at, updated_at)"
                                + " VALUES (?, ?, true, now(), now()) RETURNING id",
                        Long.class,
                        CARD_CORP_CODE,
                        alias);
        jdbc.update(
                "INSERT INTO company_aliases (company_id, alias, created_at) VALUES (?, ?, now())",
                companyId,
                alias);
        return jdbc.queryForObject(
                "INSERT INTO company_cards (company_id, card, content_hash, generated_at,"
                        + " is_current, created_at) VALUES (?, CAST(? AS jsonb), ?, DATE"
                        + " '2026-10-30', true, now()) RETURNING id",
                Long.class,
                companyId,
                cardJson,
                "4".repeat(64));
    }

    private Long companyCardOf(long sessionId) {
        return jdbc.queryForObject(
                "SELECT company_card_id FROM interview_sessions WHERE id = ?",
                Long.class,
                sessionId);
    }

    private static MockHttpServletRequestBuilder idempotent(MockHttpServletRequestBuilder request) {
        return request.header("Idempotency-Key", UUID.randomUUID().toString());
    }

    private static MockHttpServletRequestBuilder as(
            long userId, MockHttpServletRequestBuilder request) {
        return request.with(jwt().jwt(token -> token.subject(Long.toString(userId))));
    }
}
