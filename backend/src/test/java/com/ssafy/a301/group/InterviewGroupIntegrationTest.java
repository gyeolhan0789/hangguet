package com.ssafy.a301.group;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.idempotency.IdempotencyStore;
import com.ssafy.a301.group.repository.GroupPresenceStore;
import com.ssafy.a301.interview.InMemorySessionRuntimeStore;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.service.AiResultService;
import com.ssafy.a301.interview.service.AiResultService.Outcome;
import com.ssafy.a301.interview.service.InvalidAiResultException;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.Instant;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL로 10.1~10.6(만들기 → 초대 확인 → 참가 → 조회 → 준비 → 나가기)과 정원 · 다른 그룹 참가 · 방장 넘기기 · 오래된 대기 그룹
 * 취소를 확인한다. 기준: API 명세 10장, docs/그룹면접-설계.md 6.1 · 9장. Redis 진행 상태는 메모리 저장소, 작업 큐 · 멱등 키 저장소 · 면접방은
 * 가짜로 바꾸고, 대기실 접속 시각은 실제 Redis에 둔다. 5장 면접 테스트와 같은 설정이라 Spring 설정을 새로 띄우지 않는다(DB 연결 수). 만든 회원과 데이터만
 * 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(InMemorySessionRuntimeStore.Config.class)
class InterviewGroupIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private UserRepository users;
    @Autowired private ApplicationRepository applications;
    @Autowired private InterviewSessionRepository sessions;
    @Autowired private AiResultService results;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private InMemorySessionRuntimeStore runtimes;
    @Autowired private GroupPresenceStore presence;
    @Autowired private StringRedisTemplate redis;
    @MockitoBean private AiJobQueue queue;
    @MockitoBean private IdempotencyStore idempotency;
    @MockitoBean private InterviewRoom rooms;
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<Long> userIds = new ArrayList<>();

    @BeforeEach
    void setUp() {
        runtimes.clear();
    }

    @AfterEach
    void cleanup() {
        for (long id : userIds) {
            String sessionsOfUser = "SELECT id FROM interview_sessions WHERE user_id = " + id;
            jdbc.update("DELETE FROM interview_group_participants WHERE user_id = ?", id);
            jdbc.update("DELETE FROM interview_plans WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM ai_job_outbox WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM interview_sessions WHERE user_id = ?", id);
        }
        for (long id : userIds) {
            for (long groupId :
                    jdbc.queryForList(
                            "SELECT id FROM interview_groups WHERE host_user_id = ?",
                            Long.class,
                            id)) {
                redis.delete("group:" + groupId + ":presence");
            }
            jdbc.update("DELETE FROM interview_groups WHERE host_user_id = ?", id);
        }
        for (long id : userIds) {
            jdbc.update("DELETE FROM applications WHERE user_id = ?", id);
            jdbc.update("DELETE FROM users WHERE id = ?", id);
        }
    }

    @Test
    void createMakesWaitingGroupWithHostSessionAndGroupPlan() throws Exception {
        long host = newUser("방장");

        JsonNode group =
                read(
                        mvc.perform(createRequest(host, newApplication(host), 3))
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$.status").value("WAITING"))
                                .andExpect(jsonPath("$.mode").value("VIDEO"))
                                .andExpect(jsonPath("$.persona").value("COFFEE_CHAT"))
                                .andExpect(jsonPath("$.jobCategory").value("DEVELOPMENT"))
                                .andExpect(jsonPath("$.capacity").value(3))
                                .andExpect(jsonPath("$.hostUserId").value(host))
                                .andExpect(jsonPath("$.participants.length()").value(1))
                                .andExpect(jsonPath("$.participants[0].nickname").value("방장"))
                                .andExpect(
                                        jsonPath("$.participants[0].planStatus")
                                                .value("GENERATING"))
                                .andExpect(jsonPath("$.participants[0].ready").value(false))
                                .andExpect(jsonPath("$.participants[0].turnOrder").doesNotExist())
                                .andExpect(jsonPath("$.participants[0].state").value("WAITING"))
                                .andExpect(jsonPath("$.jobCategoryMismatch").doesNotExist()));
        assertThat(group.path("inviteCode").asString()).matches("[2-9A-HJKMNP-Z]{6}");
        long sessionId = group.path("mySessionId").asLong();
        assertThat(group.path("participants").get(0).path("sessionId").asLong())
                .isEqualTo(sessionId);

        // 그룹용 PLAN은 질문 2개(AI 명세 2장 questionCount)
        verify(queue)
                .push(
                        argThat(
                                job ->
                                        "PLAN".equals(job.get("jobType"))
                                                && Long.valueOf(sessionId)
                                                        .equals(job.get("sessionId"))
                                                && Integer.valueOf(2)
                                                        .equals(job.get("questionCount"))));
        InterviewSession session = sessions.findById(sessionId).orElseThrow();
        assertThat(session.getGroupId()).isEqualTo(group.path("groupId").asLong());
        // 면접은 5.2로 보고, 시작은 그룹으로만 한다(API 명세 10.10)
        mvc.perform(as(host, get("/api/v1/interview-sessions/" + sessionId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("READY"));
        runtimes.values.put(sessionId, new SessionRuntime(PlanStatus.READY, null, null, 0));
        mvc.perform(
                        as(
                                host,
                                idempotent(
                                        post(
                                                "/api/v1/interview-sessions/"
                                                        + sessionId
                                                        + "/start"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("GROUP_SESSION"));
    }

    @Test
    void personalPlanJobHasNoQuestionCount() throws Exception {
        long user = newUser("개인");

        mvc.perform(
                        as(user, idempotent(post("/api/v1/interview-sessions")))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        json.writeValueAsString(
                                                Map.of(
                                                        "applicationId",
                                                        newApplication(user),
                                                        "persona",
                                                        "DEVIL",
                                                        "mode",
                                                        "CHAT"))))
                .andExpect(status().isCreated());

        verify(queue)
                .push(
                        argThat(
                                job ->
                                        "PLAN".equals(job.get("jobType"))
                                                && !job.containsKey("questionCount")));
    }

    @Test
    void inviteAndJoinUseGroupModeAndReportJobCategoryMismatch() throws Exception {
        long host = newUser("방장");
        JsonNode group = create(host, 3);
        String code = group.path("inviteCode").asString();
        long guest = newUser("손님");

        // 소문자로 보내도 같은 코드
        mvc.perform(as(guest, get("/api/v1/interview-groups/invites/" + code.toLowerCase())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.groupId").value(group.path("groupId").asLong()))
                .andExpect(jsonPath("$.hostNickname").value("방장"))
                .andExpect(jsonPath("$.mode").value("VIDEO"))
                .andExpect(jsonPath("$.capacity").value(3))
                .andExpect(jsonPath("$.participantCount").value(1));

        JsonNode joined =
                read(
                        mvc.perform(joinRequest(guest, code, newApplication(guest), "DATA_AI"))
                                .andExpect(status().isCreated())
                                .andExpect(jsonPath("$.jobCategoryMismatch").value(true))
                                .andExpect(jsonPath("$.hostUserId").value(host))
                                .andExpect(jsonPath("$.participants.length()").value(2))
                                .andExpect(jsonPath("$.participants[1].userId").value(guest))
                                .andExpect(
                                        jsonPath("$.participants[1].jobCategory")
                                                .value("DATA_AI")));
        InterviewSession guestSession =
                sessions.findById(joined.path("mySessionId").asLong()).orElseThrow();
        assertThat(guestSession.getMode().name()).isEqualTo("VIDEO");
        assertThat(guestSession.getPersona().name()).isEqualTo("COFFEE_CHAT");
        assertThat(guestSession.getGroupId()).isEqualTo(group.path("groupId").asLong());

        long third = newUser("셋째");
        mvc.perform(joinRequest(third, code, newApplication(third), "DEVELOPMENT"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.jobCategoryMismatch").value(false))
                .andExpect(jsonPath("$.participants.length()").value(3));
    }

    @Test
    void joinRejectsFullGroupOtherGroupUnknownCodeAndOthersApplication() throws Exception {
        long host = newUser("방장");
        JsonNode group = create(host, 2);
        String code = group.path("inviteCode").asString();
        long guest = newUser("손님");
        long late = newUser("늦은 손님");

        // 남의 지원서로는 들어가지 못하고 아무것도 남지 않는다
        mvc.perform(joinRequest(guest, code, newApplication(host), "DEVELOPMENT"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        mvc.perform(joinRequest(guest, code, newApplication(guest), "DEVELOPMENT"))
                .andExpect(status().isCreated());

        mvc.perform(joinRequest(late, code, newApplication(late), "DEVELOPMENT"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("GROUP_FULL"));
        mvc.perform(joinRequest(guest, code, newApplication(guest), "DEVELOPMENT"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_IN_GROUP"));
        mvc.perform(createRequest(host, newApplication(host), 2))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ALREADY_IN_GROUP"));
        mvc.perform(joinRequest(late, "ZZZZZZ", newApplication(late), "DEVELOPMENT"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
        mvc.perform(as(late, get("/api/v1/interview-groups/invites/ZZZZZZ")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
        assertThat(activeParticipants(group.path("groupId").asLong())).isEqualTo(2);
    }

    // 기준: docs/그룹면접-설계.md 9장(마지막 자리에 두 명이 동시에 참가하면 늦은 쪽 409 GROUP_FULL)
    @Test
    void concurrentJoinsForLastSeatLetOnlyOneIn() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 3; round++) {
                long host = newUser("방장");
                JsonNode group = create(host, 2);
                String code = group.path("inviteCode").asString();
                long first = newUser("손님1");
                long second = newUser("손님2");
                long firstApplication = newApplication(first);
                long secondApplication = newApplication(second);
                CountDownLatch start = new CountDownLatch(1);

                Future<Integer> a =
                        pool.submit(
                                () -> {
                                    start.await();
                                    return joinStatus(first, code, firstApplication);
                                });
                Future<Integer> b =
                        pool.submit(
                                () -> {
                                    start.await();
                                    return joinStatus(second, code, secondApplication);
                                });
                start.countDown();

                assertThat(List.of(a.get(10, TimeUnit.SECONDS), b.get(10, TimeUnit.SECONDS)))
                        .containsExactlyInAnyOrder(201, 409);
                assertThat(activeParticipants(group.path("groupId").asLong())).isEqualTo(2);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void onlyParticipantsSeeGroupAndReadyToggles() throws Exception {
        long host = newUser("방장");
        JsonNode group = create(host, 2);
        long groupId = group.path("groupId").asLong();
        long outsider = newUser("밖");

        mvc.perform(as(outsider, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
        mvc.perform(readyRequest(outsider, groupId, true))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));

        mvc.perform(readyRequest(host, groupId, true))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].ready").value(true));
        // 다시 보내도 같다
        mvc.perform(readyRequest(host, groupId, true))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].ready").value(true));
        mvc.perform(readyRequest(host, groupId, false))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participants[0].ready").value(false));
        mvc.perform(as(host, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inviteCode").value(group.path("inviteCode").asString()));
    }

    @Test
    void hostLeavingHandsOverAndLastLeaveCancels() throws Exception {
        long host = newUser("방장");
        JsonNode group = create(host, 3);
        long groupId = group.path("groupId").asLong();
        String code = group.path("inviteCode").asString();
        long second = newUser("둘째");
        long third = newUser("셋째");
        join(second, code);
        join(third, code);

        mvc.perform(as(host, delete("/api/v1/interview-groups/" + groupId + "/participants/me")))
                .andExpect(status().isNoContent());

        // 남은 참가자 중 가장 먼저 들어온 사람이 방장이 된다
        mvc.perform(as(third, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hostUserId").value(second))
                .andExpect(jsonPath("$.participants.length()").value(2));
        mvc.perform(as(host, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(status().isNotFound());
        // 나간 면접은 시작하지 않은 채 남는다
        assertThat(sessions.findById(group.path("mySessionId").asLong()).orElseThrow().getStatus())
                .hasToString("READY");
        // 나갔으므로 다른 그룹을 만들 수 있다
        mvc.perform(createRequest(host, newApplication(host), 2)).andExpect(status().isCreated());

        mvc.perform(as(second, delete("/api/v1/interview-groups/" + groupId + "/participants/me")))
                .andExpect(status().isNoContent());
        mvc.perform(as(third, delete("/api/v1/interview-groups/" + groupId + "/participants/me")))
                .andExpect(status().isNoContent());
        assertThat(groupStatus(groupId)).isEqualTo("CANCELLED");
        mvc.perform(as(third, get("/api/v1/interview-groups/invites/" + code)))
                .andExpect(status().isNotFound());
        mvc.perform(as(third, delete("/api/v1/interview-groups/" + groupId + "/participants/me")))
                .andExpect(status().isNotFound());
    }

    @Test
    void hostAwayFromLobbyHandsOverOnOthersPoll() throws Exception {
        long host = newUser("방장");
        JsonNode group = create(host, 3);
        long groupId = group.path("groupId").asLong();
        long second = newUser("둘째");
        long third = newUser("셋째");
        join(second, group.path("inviteCode").asString());
        join(third, group.path("inviteCode").asString());

        // 방장이 막 조회했으면 그대로다
        mvc.perform(as(third, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(jsonPath("$.hostUserId").value(host));

        presence.record(groupId, host, Instant.now().minusSeconds(11));
        mvc.perform(as(third, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hostUserId").value(second))
                .andExpect(jsonPath("$.participants.length()").value(3));
        // 돌아온 이전 방장은 참가자로 남는다
        mvc.perform(as(host, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hostUserId").value(second));
    }

    // Redis 재시작 등으로 방장의 접속 기록을 잃으면 바로 넘기지 않고 그때부터 센다
    @Test
    void lostHostPresenceStartsCountingInsteadOfHandingOver() throws Exception {
        long host = newUser("방장");
        JsonNode group = create(host, 2);
        long groupId = group.path("groupId").asLong();
        long guest = newUser("손님");
        join(guest, group.path("inviteCode").asString());
        presence.remove(groupId, host);

        mvc.perform(as(guest, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hostUserId").value(host));
        assertThat(presence.lastSeen(groupId, host)).isPresent();
    }

    // 탈퇴한 회원은 나간 것과 같다. 자리가 비고, 방장이면 다른 참가자에게 넘어간다
    @Test
    void withdrawnMembersAreTreatedAsLeft() throws Exception {
        long host = newUser("방장");
        JsonNode group = create(host, 2);
        long groupId = group.path("groupId").asLong();
        String code = group.path("inviteCode").asString();
        long guest = newUser("손님");
        join(guest, code);
        jdbc.update("UPDATE users SET deleted_at = now() WHERE id = ?", guest);

        long late = newUser("늦은 손님");
        mvc.perform(joinRequest(late, code, newApplication(late), "DEVELOPMENT"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.participants.length()").value(2));

        jdbc.update("UPDATE users SET deleted_at = now() WHERE id = ?", host);
        mvc.perform(as(late, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hostUserId").value(late))
                .andExpect(jsonPath("$.participants.length()").value(1));
    }

    @Test
    void oldWaitingGroupIsCancelledAndDoesNotBlockNewGroup() throws Exception {
        long host = newUser("방장");
        JsonNode group = create(host, 2);
        long groupId = group.path("groupId").asLong();
        jdbc.update(
                "UPDATE interview_groups SET created_at = now() - interval '61 minutes' WHERE id ="
                        + " ?",
                groupId);
        long guest = newUser("손님");

        mvc.perform(
                        as(
                                guest,
                                get(
                                        "/api/v1/interview-groups/invites/"
                                                + group.path("inviteCode").asString())))
                .andExpect(status().isNotFound());
        mvc.perform(
                        joinRequest(
                                guest,
                                group.path("inviteCode").asString(),
                                newApplication(guest),
                                "DEVELOPMENT"))
                .andExpect(status().isNotFound());
        mvc.perform(readyRequest(host, groupId, true))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));

        // 조회하지 않았어도 새 그룹을 만들 때 오래된 그룹을 취소한다
        mvc.perform(createRequest(host, newApplication(host), 2)).andExpect(status().isCreated());
        assertThat(groupStatus(groupId)).isEqualTo("CANCELLED");
        mvc.perform(as(host, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.inviteCode").doesNotExist());
    }

    @Test
    void oldWaitingGroupIsCancelledOnPoll() throws Exception {
        long host = newUser("방장");
        long groupId = create(host, 2).path("groupId").asLong();
        jdbc.update(
                "UPDATE interview_groups SET created_at = now() - interval '61 minutes' WHERE id ="
                        + " ?",
                groupId);

        mvc.perform(as(host, get("/api/v1/interview-groups/" + groupId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));
        mvc.perform(as(host, delete("/api/v1/interview-groups/" + groupId + "/participants/me")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
    }

    // 기준: AI 명세 2장(그룹 면접 PLAN은 질문 2개, seq 1~2)
    @Test
    void groupPlanNeedsTwoQuestions() throws Exception {
        long host = newUser("방장");
        long sessionId = create(host, 2).path("mySessionId").asLong();

        assertThatThrownBy(() -> results.handle(planCompleted(sessionId, 5)))
                .isInstanceOf(InvalidAiResultException.class);
        assertThat(results.handle(planCompleted(sessionId, 2))).isEqualTo(Outcome.SAVED);
        assertThat(runtimes.find(sessionId).orElseThrow().planStatus()).isEqualTo(PlanStatus.READY);
    }

    @Test
    void createValidatesCapacity() throws Exception {
        long host = newUser("방장");

        mvc.perform(createRequest(host, newApplication(host), 4))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("capacity"));
        mvc.perform(createRequest(host, newApplication(host), 1))
                .andExpect(status().isBadRequest());
    }

    private JsonNode create(long userId, int capacity) throws Exception {
        return read(
                mvc.perform(createRequest(userId, newApplication(userId), capacity))
                        .andExpect(status().isCreated()));
    }

    private void join(long userId, String code) throws Exception {
        mvc.perform(joinRequest(userId, code, newApplication(userId), "DEVELOPMENT"))
                .andExpect(status().isCreated());
    }

    private int joinStatus(long userId, String code, long applicationId) throws Exception {
        return mvc.perform(joinRequest(userId, code, applicationId, "DEVELOPMENT"))
                .andReturn()
                .getResponse()
                .getStatus();
    }

    private MockHttpServletRequestBuilder createRequest(
            long userId, long applicationId, int capacity) {
        return as(userId, idempotent(post("/api/v1/interview-groups")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        json.writeValueAsString(
                                Map.of(
                                        "mode", "VIDEO",
                                        "persona", "COFFEE_CHAT",
                                        "capacity", capacity,
                                        "jobCategory", "DEVELOPMENT",
                                        "applicationId", applicationId)));
    }

    private MockHttpServletRequestBuilder joinRequest(
            long userId, String code, long applicationId, String jobCategory) {
        return as(userId, idempotent(post("/api/v1/interview-groups/join")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        json.writeValueAsString(
                                Map.of(
                                        "inviteCode", code,
                                        "applicationId", applicationId,
                                        "jobCategory", jobCategory)));
    }

    private MockHttpServletRequestBuilder readyRequest(long userId, long groupId, boolean ready) {
        return as(userId, put("/api/v1/interview-groups/" + groupId + "/ready"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("ready", ready)));
    }

    private JsonNode read(org.springframework.test.web.servlet.ResultActions result)
            throws Exception {
        return json.readTree(result.andReturn().getResponse().getContentAsString());
    }

    private long activeParticipants(long groupId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM interview_group_participants WHERE group_id = ? AND left_at"
                        + " IS NULL",
                Long.class,
                groupId);
    }

    private String groupStatus(long groupId) {
        return jdbc.queryForObject(
                "SELECT status FROM interview_groups WHERE id = ?", String.class, groupId);
    }

    private static String planCompleted(long sessionId, int questionCount) {
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
                .formatted(sessionId, questionsJson);
    }

    private long newUser(String nickname) {
        long id =
                users.saveAndFlush(
                                new User(
                                        "group-it-" + UUID.randomUUID() + "@example.com",
                                        "hash",
                                        nickname))
                        .getId();
        userIds.add(id);
        return id;
    }

    private long newApplication(long userId) {
        return applications
                .saveAndFlush(new Application(users.getReferenceById(userId), "○○전자", "백엔드 개발자"))
                .getId();
    }

    private static MockHttpServletRequestBuilder idempotent(MockHttpServletRequestBuilder request) {
        return request.header("Idempotency-Key", UUID.randomUUID().toString());
    }

    private static MockHttpServletRequestBuilder as(
            long userId, MockHttpServletRequestBuilder request) {
        return request.with(jwt().jwt(token -> token.subject(Long.toString(userId))));
    }
}
