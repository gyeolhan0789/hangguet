package com.ssafy.a301.group;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mockingDetails;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.idempotency.IdempotencyStore;
import com.ssafy.a301.group.repository.GroupPresenceStore;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import com.ssafy.a301.group.service.GroupAbsenceService;
import com.ssafy.a301.group.service.GroupDeadlineService;
import com.ssafy.a301.group.service.GroupEndService;
import com.ssafy.a301.group.service.GroupResultService;
import com.ssafy.a301.interview.InMemorySessionRuntimeStore;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.AiJobRepository;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.room.GroupRoomEvent;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.room.InterviewRoom.GroupPresence;
import com.ssafy.a301.interview.service.AiJobMessages;
import com.ssafy.a301.interview.service.AiResultService;
import com.ssafy.a301.interview.service.AiResultService.Outcome;
import com.ssafy.a301.interview.service.InterviewCapacity;
import com.ssafy.a301.interview.service.InvalidAiResultException;
import com.ssafy.a301.result.dto.ResultDtos.ReplayResponse;
import com.ssafy.a301.result.dto.ResultDtos.ReplaySegment;
import com.ssafy.a301.result.dto.ResultDtos.VideoStatus;
import com.ssafy.a301.result.service.ResultService;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import io.micrometer.core.instrument.MeterRegistry;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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
import org.mockito.invocation.Invocation;
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
import org.springframework.transaction.support.TransactionTemplate;
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
    @Autowired private InterviewQuestionRepository questions;
    @Autowired private AnswerRepository answers;
    @Autowired private GroupEndService groupEnds;
    @Autowired private AiResultService results;
    @Autowired private GroupResultService groupResults;
    @Autowired private GroupDeadlineService deadlines;
    @Autowired private GroupAbsenceService absences;
    @Autowired private ResultService resultService;
    @Autowired private AiJobMessages jobMessages;
    @Autowired private AiJobRepository aiJobRepository;
    @Autowired private TransactionTemplate transactions;
    @Autowired private InterviewGroupRepository groups;
    @Autowired private MeterRegistry meters;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private InMemorySessionRuntimeStore runtimes;
    @Autowired private GroupPresenceStore presence;
    @Autowired private StringRedisTemplate redis;
    @MockitoBean private AiJobQueue queue;
    @MockitoBean private IdempotencyStore idempotency;
    @MockitoBean private InterviewRoom rooms;
    // 상한은 InterviewCapacityTest가 실제 DB로 확인한다. 여기서는 DB에 남은 다른 면접 수에 흔들리지 않게 바꾼다
    @MockitoBean private InterviewCapacity interviewCapacity;
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<Long> userIds = new ArrayList<>();

    @BeforeEach
    void setUp() {
        runtimes.clear();
    }

    @AfterEach
    void cleanup() {
        for (long id : userIds) {
            // 그룹의 현재 차례가 면접을 가리키므로 면접보다 먼저 푼다
            jdbc.update(
                    "UPDATE interview_groups SET turn_session_id = NULL WHERE host_user_id = ?",
                    id);
        }
        for (long id : userIds) {
            String sessionsOfUser = "SELECT id FROM interview_sessions WHERE user_id = " + id;
            jdbc.update("DELETE FROM interview_group_participants WHERE user_id = ?", id);
            jdbc.update(
                    "DELETE FROM answers WHERE question_id IN (SELECT id FROM interview_questions"
                            + " WHERE session_id IN ("
                            + sessionsOfUser
                            + "))");
            jdbc.update(
                    "DELETE FROM interview_questions WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM practice_logs WHERE user_id = ?", id);
            jdbc.update("DELETE FROM interview_plans WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM ai_job_outbox WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM recordings WHERE session_id IN (" + sessionsOfUser + ")");
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

    // 기준: API 명세 10.7 · 10.10(5.14) · 10.11, AI 명세 6.7, docs/그룹면접-설계.md 6.2
    @Test
    void startOpensOneRoomForAllSessionsWithFirstTurn() throws Exception {
        ReadyGroup group = readyGroup(2);
        long hostSession = group.sessionIds().get(0);
        long guestSession = group.sessionIds().get(1);
        when(rooms.issueGroupAccess(anyLong(), anyLong(), anyBoolean()))
                .thenReturn(new RoomResponse("wss://rtc.test", "token", OffsetDateTime.now()));

        JsonNode started =
                read(
                        mvc.perform(startRequest(group.host(), group.groupId()))
                                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                                .andExpect(jsonPath("$.inviteCode").doesNotExist())
                                .andExpect(jsonPath("$.room.token").value("token"))
                                .andExpect(jsonPath("$.turn.turnVersion").value(1))
                                .andExpect(jsonPath("$.turn.groupStatus").value("IN_PROGRESS"))
                                .andExpect(jsonPath("$.turn.round").value(1))
                                .andExpect(jsonPath("$.turn.phase").value("ASKING"))
                                .andExpect(jsonPath("$.turn.turn.seq").value(1))
                                .andExpect(jsonPath("$.turn.turn.kind").value("COMMON"))
                                .andExpect(jsonPath("$.turn.turn.baseIndex").value(1))
                                .andExpect(jsonPath("$.turn.turn.announce").value("FULL"))
                                .andExpect(jsonPath("$.turn.turn.deadlineAt").doesNotExist())
                                .andExpect(jsonPath("$.turn.turn.followupsLeft").value(2))
                                .andExpect(jsonPath("$.turn.participants.length()").value(2))
                                .andExpect(jsonPath("$.participants[0].state").value("PRESENT")));
        // 답변 순서는 1 · 2를 하나씩 나눠 갖고, 첫 차례는 1번이다
        JsonNode turn = started.path("turn");
        long first = turn.path("turn").path("sessionId").asLong();
        assertThat(turn.path("participants").get(0).path("turnOrder").asInt()).isEqualTo(1);
        assertThat(turn.path("participants").get(0).path("sessionId").asLong()).isEqualTo(first);
        assertThat(turn.path("upcoming").get(0).asLong())
                .isEqualTo(first == hostSession ? guestSession : hostSession);
        assertThat(sessions.findById(hostSession).orElseThrow().getStatus())
                .isEqualTo(SessionStatus.IN_PROGRESS);
        assertThat(sessions.findById(guestSession).orElseThrow().getStatus())
                .isEqualTo(SessionStatus.IN_PROGRESS);

        // 방 하나에 에이전트 하나. 공통 질문 2개와 참가자별 개인 질문 2개를 답변 순서대로 넘긴다
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> assignment = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<String> metadata = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<OffsetDateTime> startedAt = ArgumentCaptor.forClass(OffsetDateTime.class);
        verify(rooms)
                .openGroup(
                        eq(group.groupId()),
                        eq(true),
                        assignment.capture(),
                        metadata.capture(),
                        startedAt.capture());
        // 녹화 원본 위치를 나눌 시작 시도 시각은 그룹 · 면접 시작 시각이다
        assertThat(
                        sessions.findById(group.sessionIds().get(0))
                                .orElseThrow()
                                .getStartedAt()
                                .toInstant()
                                .toEpochMilli())
                .isEqualTo(startedAt.getValue().toInstant().toEpochMilli());
        verify(rooms, never()).open(anyLong(), anyBoolean(), anyMap());
        JsonNode dispatched = json.valueToTree(assignment.getValue());
        assertThat(dispatched.path("kind").asString()).isEqualTo("GROUP");
        assertThat(dispatched.path("groupId").asLong()).isEqualTo(group.groupId());
        assertThat(dispatched.path("commonQuestions").size()).isEqualTo(2);
        assertThat(dispatched.path("commonQuestions").get(0).path("content").asString())
                .contains("자기소개");
        JsonNode firstParticipant = dispatched.path("participants").get(0);
        assertThat(firstParticipant.path("sessionId").asLong()).isEqualTo(first);
        assertThat(firstParticipant.path("identity").asString()).isEqualTo("candidate-" + first);
        assertThat(firstParticipant.path("personalQuestions").size()).isEqualTo(2);
        assertThat(firstParticipant.path("personalQuestions").get(0).path("content").asString())
                .isEqualTo("질문1");
        // 면접방 정보는 응답의 turn과 같은 형식이다
        JsonNode roomInfo = json.readTree(metadata.getValue());
        assertThat(roomInfo.path("turnVersion").asInt()).isEqualTo(1);
        assertThat(roomInfo.path("turn").path("sessionId").asLong()).isEqualTo(first);
        assertThat(roomInfo.path("serverTime").isString()).isTrue();
        verify(rooms).issueGroupAccess(group.groupId(), hostSession, true);

        // 다른 참가자는 10.4로 시작을 보고 5.14로 같은 방의 자기 입장 정보를 받는다
        mvc.perform(as(group.guests().get(0), get("/api/v1/interview-groups/" + group.groupId())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("IN_PROGRESS"))
                .andExpect(jsonPath("$.turn.turnVersion").value(1));
        mvc.perform(
                        as(
                                group.guests().get(0),
                                post("/api/v1/interview-sessions/" + guestSession + "/room-token")))
                .andExpect(status().isOk());
        verify(rooms).issueGroupAccess(group.groupId(), guestSession, true);
        verify(rooms, never()).issueAccess(anyLong(), anyBoolean());

        // 두 번 시작하지 않는다
        mvc.perform(startRequest(group.host(), group.groupId()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_GROUP_STATE"));
    }

    @Test
    void startNeedsHostFullGroupReadyParticipantsAndPlans() throws Exception {
        long host = newUser("방장");
        JsonNode group = create(host, 3);
        long groupId = group.path("groupId").asLong();
        long guest = newUser("손님");
        join(guest, group.path("inviteCode").asString());

        mvc.perform(startRequest(guest, groupId))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("NOT_GROUP_HOST"));
        mvc.perform(startRequest(newUser("남"), groupId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_FOUND"));
        // 정원 3명 중 2명
        mvc.perform(startRequest(host, groupId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_READY"));

        long third = newUser("셋째");
        join(third, group.path("inviteCode").asString());
        for (long user : List.of(host, guest, third)) {
            mvc.perform(readyRequest(user, groupId, true)).andExpect(status().isOk());
        }
        // 모두 준비했지만 질문 생성 중
        mvc.perform(startRequest(host, groupId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_READY"));
        for (long sessionId : sessionIds(groupId)) {
            results.handle(planCompleted(sessionId, 2));
        }
        // 한 명이 준비를 취소함
        mvc.perform(readyRequest(third, groupId, false)).andExpect(status().isOk());
        mvc.perform(startRequest(host, groupId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("GROUP_NOT_READY"));
        assertThat(groupStatus(groupId)).isEqualTo("WAITING");
        verify(rooms, never()).openGroup(anyLong(), anyBoolean(), anyMap(), anyString(), any());
    }

    @Test
    void roomFailureLeavesGroupAndSessionsAsBefore() throws Exception {
        ReadyGroup group = readyGroup(2);
        doThrow(new ApiException(ErrorCode.ROOM_UNAVAILABLE))
                .when(rooms)
                .openGroup(anyLong(), anyBoolean(), anyMap(), anyString(), any());

        mvc.perform(startRequest(group.host(), group.groupId()))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("ROOM_UNAVAILABLE"));

        assertThat(groupStatus(group.groupId())).isEqualTo("WAITING");
        for (long sessionId : group.sessionIds()) {
            assertThat(sessions.findById(sessionId).orElseThrow().getStatus())
                    .isEqualTo(SessionStatus.READY);
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM interview_group_participants WHERE group_id"
                                        + " = ? AND turn_order IS NOT NULL",
                                Long.class,
                                group.groupId()))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT common_questions IS NULL FROM interview_groups WHERE id"
                                        + " = ?",
                                Boolean.class,
                                group.groupId()))
                .isTrue();
    }

    // 5.8: 내 면접만 끝내고 나머지는 계속한다. 마지막 면접이 끝나면 그룹이 끝나고 방을 지운다(docs/그룹면접-설계.md 6.10)
    @Test
    void endingSessionsOneByOneEndsGroupWithLastOne() throws Exception {
        ReadyGroup group = readyGroup(2);
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        long hostSession = group.sessionIds().get(0);
        long guestSession = group.sessionIds().get(1);
        long guest = group.guests().getFirst();
        answered(hostSession);

        mvc.perform(endRequest(group.host(), hostSession))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("ANALYZING"))
                .andExpect(jsonPath("$.answeredCount").value(1));
        // 남은 사람은 계속한다. 끝낸 사람만 방에서 내보낸다
        assertThat(groupStatus(group.groupId())).isEqualTo("IN_PROGRESS");
        assertThat(endReason(hostSession)).isEqualTo("USER_ENDED");
        assertThat(jobTypes(hostSession)).containsExactlyInAnyOrder("PLAN", "EVALUATE");
        verify(rooms).removeGroupParticipant(group.groupId(), hostSession);
        verify(rooms, never()).closeGroup(anyLong());
        // 한 번 더 끝내면 409
        mvc.perform(endRequest(group.host(), hostSession))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("INVALID_SESSION_STATE"));

        mvc.perform(endRequest(guest, guestSession))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ABORTED"));
        assertThat(groupStatus(group.groupId())).isEqualTo("ENDED");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT ended_at IS NOT NULL FROM interview_groups WHERE id = ?",
                                Boolean.class,
                                group.groupId()))
                .isTrue();
        verify(rooms).closeGroup(group.groupId());
        verify(rooms, never()).removeGroupParticipant(group.groupId(), guestSession);
        // 녹화 합치기는 그룹이 끝날 때 넣는다(6.12). 개인 면접 방은 쓰지 않는다
        assertThat(jobTypes(hostSession)).contains("MERGE_RECORDING");
        verify(rooms, never()).close(anyLong());
    }

    // 다른 사람의 그룹 면접은 끝낼 수 없다(404)
    @Test
    void othersGroupSessionCannotBeEnded() throws Exception {
        ReadyGroup group = readyGroup(2);
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());

        mvc.perform(endRequest(group.guests().getFirst(), group.sessionIds().get(0)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
        assertThat(sessions.findById(group.sessionIds().get(0)).orElseThrow().getStatus())
                .isEqualTo(SessionStatus.IN_PROGRESS);
    }

    // 안전장치(6.11): 오래전에 시작했고 진행도 멈춘 그룹만 남은 면접을 끝낸다
    @Test
    void stalledGroupIsCleanedUpButProgressingGroupIsNot() throws Exception {
        ReadyGroup stalled = readyGroup(2);
        mvc.perform(startRequest(stalled.host(), stalled.groupId())).andExpect(status().isOk());
        ReadyGroup progressing = readyGroup(2);
        mvc.perform(startRequest(progressing.host(), progressing.groupId()))
                .andExpect(status().isOk());
        OffsetDateTime now = OffsetDateTime.now();
        jdbc.update(
                "UPDATE interview_groups SET started_at = ?, progressed_at = ? WHERE id = ?",
                now.minusMinutes(61),
                now.minusMinutes(6),
                stalled.groupId());
        // 오래 걸려도 방금 진행했으면 정상이다
        jdbc.update(
                "UPDATE interview_groups SET started_at = ?, progressed_at = ? WHERE id = ?",
                now.minusMinutes(61),
                now.minusMinutes(1),
                progressing.groupId());

        groupEnds.cleanupStalled(now);

        assertThat(groupStatus(stalled.groupId())).isEqualTo("ENDED");
        for (long sessionId : stalled.sessionIds()) {
            assertThat(sessions.findById(sessionId).orElseThrow().getStatus())
                    .isEqualTo(SessionStatus.ABORTED);
            assertThat(endReason(sessionId)).isEqualTo("CLEANUP");
        }
        verify(rooms).closeGroup(stalled.groupId());
        assertThat(groupStatus(progressing.groupId())).isEqualTo("IN_PROGRESS");
        verify(rooms, never()).closeGroup(progressing.groupId());
    }

    // 그룹은 화상 면접 하나로 센다. 상한에 닿으면 그룹 · 면접이 그대로라 잠시 후 다시 시작할 수 있다
    @Test
    void videoGroupStartIsRejectedWhenCapacityIsFull() throws Exception {
        ReadyGroup group = readyGroup(2);
        doThrow(new ApiException(ErrorCode.INTERVIEW_CAPACITY_FULL))
                .when(interviewCapacity)
                .reserveVideo(any());

        mvc.perform(startRequest(group.host(), group.groupId()))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("INTERVIEW_CAPACITY_FULL"));

        verify(interviewCapacity).reserveVideo(any());
        verify(rooms, never()).openGroup(anyLong(), anyBoolean(), anyMap(), anyString(), any());
        assertThat(groupStatus(group.groupId())).isEqualTo("WAITING");
        for (long sessionId : group.sessionIds()) {
            assertThat(sessions.findById(sessionId).orElseThrow().getStatus())
                    .isEqualTo(SessionStatus.READY);
        }
    }

    @Test
    void startFailingAfterRoomOpenedClosesRoom() throws Exception {
        ReadyGroup group = readyGroup(2);
        // 방은 열었는데 입장 정보를 만들다 실패해 시작이 되돌려진다
        when(rooms.issueGroupAccess(anyLong(), anyLong(), anyBoolean()))
                .thenThrow(new IllegalStateException("입장 토큰 서명 실패"));

        mvc.perform(startRequest(group.host(), group.groupId()))
                .andExpect(status().isInternalServerError());

        verify(rooms).closeGroup(group.groupId());
        assertThat(groupStatus(group.groupId())).isEqualTo("WAITING");
    }

    @Test
    void restartAfterStartFailureKeepsOrderAndCommonQuestions() throws Exception {
        ReadyGroup group = readyGroup(3);
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        String commonQuestions = commonQuestionsOf(group.groupId());
        List<Long> order = sessionIdsByTurnOrder(group.groupId());
        // 에이전트가 배정을 거절했다고 본다(배정 거절 처리는 진행 구현에서 더한다)
        jdbc.update(
                "UPDATE interview_groups SET status = 'START_FAILED' WHERE id = ?",
                group.groupId());
        jdbc.update(
                "UPDATE interview_sessions SET status = 'START_FAILED' WHERE group_id = ?",
                group.groupId());
        // 방장이 아닌 사람 중 답변 순서가 앞선 사람이 나간다
        long hostSession = group.sessionIds().get(0);
        long leaving = order.stream().filter(id -> id != hostSession).findFirst().orElseThrow();
        long leavingUser =
                jdbc.queryForObject(
                        "SELECT user_id FROM interview_sessions WHERE id = ?", Long.class, leaving);
        mvc.perform(
                        as(
                                leavingUser,
                                delete(
                                        "/api/v1/interview-groups/"
                                                + group.groupId()
                                                + "/participants/me")))
                .andExpect(status().isNoContent());

        mvc.perform(startRequest(group.host(), group.groupId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.turn.turnVersion").value(2))
                .andExpect(jsonPath("$.turn.participants.length()").value(2));

        // 남은 사람끼리 이전 순서대로 1 · 2. 공통 질문은 그대로
        List<Long> remaining = new ArrayList<>(order);
        remaining.remove(Long.valueOf(leaving));
        assertThat(sessionIdsByTurnOrder(group.groupId())).isEqualTo(remaining);
        assertThat(
                        jdbc.queryForList(
                                "SELECT turn_order FROM interview_group_participants WHERE"
                                        + " group_id = ? AND left_at IS NULL ORDER BY turn_order",
                                Integer.class,
                                group.groupId()))
                .containsExactly(1, 2);
        assertThat(commonQuestionsOf(group.groupId())).isEqualTo(commonQuestions);
        assertThat(sessions.findById(leaving).orElseThrow().getStatus())
                .isEqualTo(SessionStatus.START_FAILED);
    }

    // 방장과 손님들이 모두 준비했고 모든 그룹용 플랜이 끝난 그룹
    // 6.3 · 6.4: 채팅 2명이 기본 질문 4개를 라운드로 돌아가며 답한다. 꼬리질문은 받은 사람이 이어서 답하고, 같은 공통 질문의 다음 답변자는
    // 호명만 한다. 모두 마치면 차례가 비고 5.8은 ALL_ANSWERED로 끝낸다
    @Test
    void chatGroupGoesThroughRoundsWithFollowupAndEndsAllAnswered() throws Exception {
        ReadyGroup group = readyGroup(2, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        Map<Long, Long> users = usersBySession(group);
        List<Long> order = sessionIdsByTurnOrder(group.groupId());
        long a = order.get(0);
        long b = order.get(1);

        // 라운드 1 공통(자기소개): 첫 사람은 질문 전체, 꼬리질문은 같은 사람
        assertTurn(group.groupId(), 1, a, 1, "COMMON", "FULL");
        chatTurn(group.groupId(), users.get(a), a, 1, true);
        assertTurn(group.groupId(), 1, a, 2, "FOLLOWUP", "FULL");
        chatTurn(group.groupId(), users.get(a), a, 2, false);
        assertTurn(group.groupId(), 1, b, 1, "COMMON", "CALL");
        chatTurn(group.groupId(), users.get(b), b, 1, false);
        // 라운드 2 개인 → 3 공통(인성) → 4 개인
        assertTurn(group.groupId(), 2, a, 3, "PERSONAL", "FULL");
        chatTurn(group.groupId(), users.get(a), a, 3, false);
        assertTurn(group.groupId(), 2, b, 2, "PERSONAL", "FULL");
        chatTurn(group.groupId(), users.get(b), b, 2, false);
        assertTurn(group.groupId(), 3, a, 4, "COMMON", "FULL");
        chatTurn(group.groupId(), users.get(a), a, 4, false);
        assertTurn(group.groupId(), 3, b, 3, "COMMON", "CALL");
        chatTurn(group.groupId(), users.get(b), b, 3, false);
        assertTurn(group.groupId(), 4, a, 5, "PERSONAL", "FULL");
        chatTurn(group.groupId(), users.get(a), a, 5, false);
        // 기본 질문을 모두 마친 사람은 완료(DONE)이고 5.5는 409다
        assertThat(doneAt(a)).isNotNull();
        mvc.perform(as(users.get(a), get("/api/v1/interview-sessions/" + a + "/questions/current")))
                .andExpect(status().isConflict());
        assertTurn(group.groupId(), 4, b, 4, "PERSONAL", "FULL");
        chatTurn(group.groupId(), users.get(b), b, 4, false);

        // 남은 질문이 없으면 차례를 비우고 모두 DONE으로 알린다
        assertThat(groupRow(group.groupId()).get("turn_session_id")).isNull();
        JsonNode info = lastRoomInfo(group.groupId());
        assertThat(info.path("turn").isNull()).isTrue();
        assertThat(info.path("participants").get(0).path("state").asString()).isEqualTo("DONE");
        assertThat(info.path("participants").get(1).path("state").asString()).isEqualTo("DONE");
        // 질문 행은 공통 · 개인 · 꼬리질문 종류와 답변 시간이 남고, 답변은 끝낸 시각이 남는다
        assertThat(questionKinds(a))
                .containsExactly("COMMON", "FOLLOWUP", "PERSONAL", "COMMON", "PERSONAL");
        assertThat(questionKinds(b)).containsExactly("COMMON", "PERSONAL", "COMMON", "PERSONAL");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM answers a JOIN interview_questions q ON"
                                        + " q.id = a.question_id WHERE q.session_id = ? AND"
                                        + " a.ended_at IS NOT NULL AND q.spoken_at IS NOT NULL",
                                Long.class,
                                a))
                .isEqualTo(5L);

        mvc.perform(endRequest(users.get(a), a)).andExpect(status().isAccepted());
        assertThat(endReason(a)).isEqualTo("ALL_ANSWERED");
        mvc.perform(endRequest(users.get(b), b)).andExpect(status().isAccepted());
        assertThat(endReason(b)).isEqualTo("ALL_ANSWERED");
        assertThat(groupStatus(group.groupId())).isEqualTo("ENDED");
    }

    // 6.7: 작성 중인 글은 지금 내 차례의 답변 중인 질문에만 남고, 직접 제출하면 지운다. 그 뒤 제출 · 저장은 409다
    @Test
    void chatDraftAndSubmitOnlyForCurrentOpenQuestion() throws Exception {
        ReadyGroup group = readyGroup(2, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        Map<Long, Long> users = usersBySession(group);
        List<Long> order = sessionIdsByTurnOrder(group.groupId());
        long a = order.get(0);
        long b = order.get(1);
        handle(questionStarted(a, 1, turnVersion(group.groupId())));
        long questionId = questionId(a, 1);
        // 질문 음성이 끝나기 전(SPEAKING)에는 받지 않는다
        mvc.perform(draftRequest(users.get(a), a, questionId, "작성 중"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("QUESTION_CLOSED"));
        handle(questionSpoken(a, 1, turnVersion(group.groupId())));
        // 5.5는 지금 답할 질문을 준다. 차례를 기다리는 사람은 202
        mvc.perform(as(users.get(a), get("/api/v1/interview-sessions/" + a + "/questions/current")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(questionId));
        mvc.perform(as(users.get(b), get("/api/v1/interview-sessions/" + b + "/questions/current")))
                .andExpect(status().isAccepted());

        mvc.perform(draftRequest(users.get(a), a, questionId, "작성 중"))
                .andExpect(status().isNoContent());
        assertThat(redis.opsForValue().get("group-draft:" + a + ":" + questionId))
                .isEqualTo("작성 중");
        // 남의 면접 · 남의 질문
        mvc.perform(draftRequest(users.get(b), a, questionId, "남의 글"))
                .andExpect(status().isNotFound());
        mvc.perform(draftRequest(users.get(b), b, questionId, "남의 질문"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("QUESTION_NOT_FOUND"));

        mvc.perform(chatAnswerRequest(users.get(a), a, questionId, "최종 답변"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.isLastQuestion").value(false));
        assertThat(redis.hasKey("group-draft:" + a + ":" + questionId)).isFalse();
        assertThat(jobTypes(a)).contains("SCORE_ANSWER");
        assertThat(groupRow(group.groupId()).get("phase")).isEqualTo("DECIDING");
        // 꼬리질문 판단용으로 최종 답변을 에이전트에게 보낸다
        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(rooms).sendGroupAnswer(eq(group.groupId()), payload.capture());
        JsonNode sent = json.readTree(payload.getValue());
        assertThat(sent.path("sessionId").asLong()).isEqualTo(a);
        assertThat(sent.path("seq").asInt()).isEqualTo(1);
        assertThat(sent.path("content").asString()).isEqualTo("최종 답변");
        assertThat(sent.path("turnVersion").asInt()).isEqualTo(turnVersion(group.groupId()));

        mvc.perform(chatAnswerRequest(users.get(a), a, questionId, "또 냄"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ANSWER_ALREADY_SUBMITTED"));
        mvc.perform(draftRequest(users.get(a), a, questionId, "늦은 글"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("QUESTION_CLOSED"));
    }

    // 8.4 · 9장: 다른 차례 · 이전 버전 · 이미 지난 단계의 에이전트 메시지는 버린다. 화상 답변 · 연장(10.8)도 지금 답변자 · 단계에서만 된다
    @Test
    void videoTurnIgnoresStaleMessagesAndExtendsOnce() throws Exception {
        ReadyGroup group = readyGroup(2);
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        Map<Long, Long> users = usersBySession(group);
        List<Long> order = sessionIdsByTurnOrder(group.groupId());
        long a = order.get(0);
        long b = order.get(1);
        int version = turnVersion(group.groupId());

        assertThat(handle(questionStarted(a, 1, version - 1))).isEqualTo(Outcome.DISCARDED);
        assertThat(handle(questionStarted(b, 1, version))).isEqualTo(Outcome.DISCARDED);
        assertThat(handle(questionStarted(a, 1, version))).isEqualTo(Outcome.SAVED);
        assertThat(handle(questionStarted(a, 1, version))).isEqualTo(Outcome.DISCARDED);
        assertThat(groupRow(group.groupId()).get("phase")).isEqualTo("SPEAKING");
        // 차례 안에서는 단계가 바뀌어도 차례를 정한 뒤의 버전이면 받는다
        assertThat(handle(questionSpoken(a, 1, version))).isEqualTo(Outcome.SAVED);
        Map<String, Object> answering = groupRow(group.groupId());
        assertThat(answering.get("phase")).isEqualTo("ANSWERING");
        assertThat(answering.get("deadline_at")).isNotNull();
        assertThat(lastRoomInfo(group.groupId()).path("turn").path("deadlineAt").isString())
                .isTrue();

        // 남은 시간이 30초를 넘으면 · 답변자가 아니면 연장할 수 없다
        mvc.perform(extendRequest(users.get(a), group.groupId()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EXTEND_NOT_ALLOWED"));
        jdbc.update(
                "UPDATE interview_groups SET deadline_at = now() + interval '20 seconds' WHERE"
                        + " id = ?",
                group.groupId());
        mvc.perform(extendRequest(users.get(b), group.groupId())).andExpect(status().isConflict());
        mvc.perform(extendRequest(users.get(a), group.groupId()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.deadlineAt").exists());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT deadline_at > now() + interval '70 seconds' AND extended"
                                        + " FROM interview_groups WHERE id = ?",
                                Boolean.class,
                                group.groupId()))
                .isTrue();
        mvc.perform(extendRequest(users.get(a), group.groupId())).andExpect(status().isConflict());

        assertThat(handle(answerCompleted(a, 1, turnVersion(group.groupId()))))
                .isEqualTo(Outcome.SAVED);
        assertThat(groupRow(group.groupId()).get("phase")).isEqualTo("DECIDING");
        assertThat(jobTypes(a)).contains("SCORE_ANSWER");
        assertThat(handle(answerCompleted(a, 1, turnVersion(group.groupId()))))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(handle(questionSpoken(a, 1, turnVersion(group.groupId()))))
                .isEqualTo(Outcome.DISCARDED);

        int deciding = turnVersion(group.groupId());
        assertThat(handle(followupDecided(a, 1, deciding, false))).isEqualTo(Outcome.SAVED);
        assertTurn(group.groupId(), 1, b, 1, "COMMON", "CALL");
        // 늦게 온 같은 판단은 버린다
        assertThat(handle(followupDecided(a, 1, deciding, true))).isEqualTo(Outcome.DISCARDED);
        // 개인 면접 결과 큐로 온 그룹 면접 질문은 받지 않는다(그룹 결과 큐로만)
        assertThat(
                        results.handle(
                                json.writeValueAsString(
                                        Map.of(
                                                "type",
                                                "question.started",
                                                "sessionId",
                                                b,
                                                "seq",
                                                1,
                                                "startedAt",
                                                OffsetDateTime.now().toString(),
                                                "content",
                                                "질문",
                                                "criteria",
                                                "기준"))))
                .isEqualTo(Outcome.DISCARDED);
        // 형식이 틀린 메시지는 다시 처리해도 안 되므로 실패 목록으로 보낸다
        assertThatThrownBy(() -> handle(questionStarted(b, 7, deciding)))
                .isInstanceOf(InvalidAiResultException.class);
        assertThatThrownBy(() -> handle(questionSpoken(b, 1, deciding).replace("ENDED", "PLAYING")))
                .isInstanceOf(InvalidAiResultException.class);
        assertThatThrownBy(
                        () ->
                                handle(
                                        json.writeValueAsString(
                                                Map.of(
                                                        "type",
                                                        "assignment.unknown",
                                                        "sessionId",
                                                        b,
                                                        "seq",
                                                        1,
                                                        "turnVersion",
                                                        deciding))))
                .isInstanceOf(InvalidAiResultException.class);
    }

    // 6.10 3: 지금 답변자가 면접을 끝내면 다음 사람 차례로 넘어가고 면접방 정보를 바꾼다
    @Test
    void endingCurrentAnswererMovesTurnToNextParticipant() throws Exception {
        ReadyGroup group = readyGroup(3, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        Map<Long, Long> users = usersBySession(group);
        List<Long> order = sessionIdsByTurnOrder(group.groupId());
        handle(questionStarted(order.get(0), 1, turnVersion(group.groupId())));

        mvc.perform(endRequest(users.get(order.get(0)), order.get(0)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ABORTED"));
        assertThat(endReason(order.get(0))).isEqualTo("USER_ENDED");
        assertTurn(group.groupId(), 1, order.get(1), 1, "COMMON", "FULL");
        JsonNode info = lastRoomInfo(group.groupId());
        assertThat(info.path("participants").get(0).path("state").asString()).isEqualTo("ENDED");
        assertThat(info.path("participants").get(0).path("endReason").asString())
                .isEqualTo("USER_ENDED");
        assertThat(info.path("upcoming").size()).isEqualTo(1);

        // 답변자가 아닌 사람이 끝내도 차례는 그대로이고 버전만 올린다
        int version = turnVersion(group.groupId());
        mvc.perform(endRequest(users.get(order.get(2)), order.get(2))).andExpect(status().isOk());
        assertTurn(group.groupId(), 1, order.get(1), 1, "COMMON", "FULL");
        assertThat(turnVersion(group.groupId())).isEqualTo(version + 1);
        assertThat(lastRoomInfo(group.groupId()).path("upcoming").size()).isZero();
    }

    // 6.4 · 6.11: 질문 음성이 끝났다는 메시지가 없으면 기한에 답변 시간을 시작하고, 채팅 마감은 작성 중인 글로 최종 답변을 확정한다.
    // 꼬리질문 판단이 오지 않으면 꼬리질문 없이 다음 차례다
    @Test
    void chatDeadlinesStartAnsweringSubmitDraftAndSkipMissingDecision() throws Exception {
        ReadyGroup group = readyGroup(2, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        Map<Long, Long> users = usersBySession(group);
        List<Long> order = sessionIdsByTurnOrder(group.groupId());
        long a = order.get(0);
        handle(questionStarted(a, 1, turnVersion(group.groupId())));
        // 기한 전이면 아무것도 하지 않는다
        deadlines.expire(group.groupId(), OffsetDateTime.now());
        assertThat(groupRow(group.groupId()).get("phase")).isEqualTo("SPEAKING");

        deadlines.expire(group.groupId(), OffsetDateTime.now().plusSeconds(30));
        assertThat(groupRow(group.groupId()).get("phase")).isEqualTo("ANSWERING");
        long questionId = questionId(a, 1);
        mvc.perform(draftRequest(users.get(a), a, questionId, "마감 전 글"))
                .andExpect(status().isNoContent());

        // 채팅 마감(5분) 뒤: 작성 중인 글을 최종 답변으로 확정하고 꼬리질문 판단을 기다린다
        deadlines.expire(group.groupId(), OffsetDateTime.now().plusMinutes(6));
        assertThat(groupRow(group.groupId()).get("phase")).isEqualTo("DECIDING");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT content FROM answers WHERE question_id = ?",
                                String.class,
                                questionId))
                .isEqualTo("마감 전 글");
        assertThat(redis.hasKey("group-draft:" + a + ":" + questionId)).isFalse();
        assertThat(jobTypes(a)).contains("SCORE_ANSWER");
        verify(rooms).sendGroupAnswer(eq(group.groupId()), anyString());

        // 꼬리질문 판단이 7초 안에 오지 않으면 꼬리질문 없이 다음 사람이다(판단 기한은 마감을 처리한 시각부터 센다)
        deadlines.expire(group.groupId(), OffsetDateTime.now().plusMinutes(7));
        assertTurn(group.groupId(), 1, order.get(1), 1, "COMMON", "CALL");
        assertThat(meters.find("a301.group.followup.decision").tag("outcome", "missing").timer())
                .isNotNull();
    }

    // 6.6: 글이 없는 채팅 마감과 화상 마감은 답 없이 질문을 닫고 꼬리질문 판단 없이 다음 차례로 간다
    @Test
    void deadlineWithoutAnswerClosesQuestion() throws Exception {
        for (String mode : List.of("CHAT", "VIDEO")) {
            ReadyGroup group = readyGroup(2, mode);
            mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
            List<Long> order = sessionIdsByTurnOrder(group.groupId());
            long a = order.get(0);
            handle(questionStarted(a, 1, turnVersion(group.groupId())));
            handle(questionSpoken(a, 1, turnVersion(group.groupId())));

            deadlines.expire(group.groupId(), OffsetDateTime.now().plusMinutes(6));
            assertThat(
                            jdbc.queryForObject(
                                    "SELECT closed_at IS NOT NULL FROM interview_questions WHERE"
                                            + " id = ?",
                                    Boolean.class,
                                    questionId(a, 1)))
                    .isTrue();
            assertTurn(group.groupId(), 1, order.get(1), 1, "COMMON", "CALL");
            // 닫힌 질문에 늦게 온 답변은 받지 않는다
            assertThat(handle(answerCompleted(a, 1, turnVersion(group.groupId()))))
                    .isEqualTo(Outcome.DISCARDED);
        }
    }

    // 6.11: 질문이 시작되지 않으면 면접방 정보를 한 번 더 보내고 기다린 뒤, 첫 질문 전이면 시작 실패로 둔다
    @Test
    void agentNotAskingFirstQuestionFailsStart() throws Exception {
        ReadyGroup group = readyGroup(2);
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());

        deadlines.expire(group.groupId(), OffsetDateTime.now().plusSeconds(21));
        assertThat(groupStatus(group.groupId())).isEqualTo("IN_PROGRESS");
        assertThat(groupRow(group.groupId()).get("phase")).isEqualTo("ASKING");
        verify(rooms).updateGroupInfo(eq(group.groupId()), anyString());

        deadlines.expire(group.groupId(), OffsetDateTime.now().plusSeconds(31));
        assertThat(groupStatus(group.groupId())).isEqualTo("START_FAILED");
        for (long sessionId : group.sessionIds()) {
            assertThat(sessions.findById(sessionId).orElseThrow().getStatus())
                    .isEqualTo(SessionStatus.START_FAILED);
        }
        verify(rooms).closeGroup(group.groupId());
    }

    // 6.11 AI 장애: 질문을 낸 뒤 AI가 멈추면 남은 면접을 모두 AI_FAILURE로 끝낸다. 답변이 있으면 결과를 만들고 없으면 결과 없이 끝난다
    @Test
    void agentStallingAfterQuestionsEndsGroupAsAiFailure() throws Exception {
        ReadyGroup group = readyGroup(2, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        Map<Long, Long> users = usersBySession(group);
        List<Long> order = sessionIdsByTurnOrder(group.groupId());
        long a = order.get(0);
        long b = order.get(1);
        chatTurn(group.groupId(), users.get(a), a, 1, false);
        assertTurn(group.groupId(), 1, b, 1, "COMMON", "CALL");

        deadlines.expire(group.groupId(), OffsetDateTime.now().plusSeconds(31));
        assertThat(groupStatus(group.groupId())).isEqualTo("ENDED");
        assertThat(endReason(a)).isEqualTo("AI_FAILURE");
        assertThat(endReason(b)).isEqualTo("AI_FAILURE");
        assertThat(sessions.findById(a).orElseThrow().getStatus())
                .isEqualTo(SessionStatus.ANALYZING);
        assertThat(sessions.findById(b).orElseThrow().getStatus()).isEqualTo(SessionStatus.ABORTED);
        // 끝났다는 면접방 정보를 보낸 뒤 방을 지운다
        JsonNode info = lastRoomInfo(group.groupId());
        assertThat(info.path("groupStatus").asString()).isEqualTo("ENDED");
        assertThat(info.path("participants").get(0).path("endReason").asString())
                .isEqualTo("AI_FAILURE");
        verify(rooms).closeGroup(group.groupId());
    }

    // 5.1: 그룹 배정 거절은 첫 질문 전에만 시작 실패로 바꾼다. 다시 시작하기 전의 늦은 거절은 버린다
    @Test
    void groupAssignmentRejectionFailsStartOnlyBeforeFirstQuestion() throws Exception {
        ReadyGroup group = readyGroup(2);
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());

        assertThat(handle(rejected(group.groupId(), OffsetDateTime.now().minusHours(1))))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(handle(rejected(group.groupId(), OffsetDateTime.now())))
                .isEqualTo(Outcome.SAVED);
        assertThat(groupStatus(group.groupId())).isEqualTo("START_FAILED");
        verify(rooms).closeGroup(group.groupId());

        ReadyGroup asked = readyGroup(2);
        mvc.perform(startRequest(asked.host(), asked.groupId())).andExpect(status().isOk());
        long first = sessionIdsByTurnOrder(asked.groupId()).get(0);
        handle(questionStarted(first, 1, turnVersion(asked.groupId())));
        assertThat(handle(rejected(asked.groupId(), OffsetDateTime.now())))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(groupStatus(asked.groupId())).isEqualTo("IN_PROGRESS");
    }

    // 6.10: 질문을 모두 마치고 5.8이 없으면 BE가 ALL_ANSWERED로 끝낸다. 마치지 않은 사람은 끝내지 않는다
    @Test
    void doneParticipantWithoutEndRequestIsEndedAllAnswered() throws Exception {
        ReadyGroup group = readyGroup(2, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        long a = group.sessionIds().get(0);
        long b = group.sessionIds().get(1);

        assertThat(groupEnds.endAfterDone(group.groupId(), a)).isFalse();
        jdbc.update(
                "UPDATE interview_group_participants SET done_at = now() - interval '2 minutes'"
                        + " WHERE session_id = ?",
                a);
        assertThat(groupEnds.endAfterDone(group.groupId(), a)).isTrue();
        assertThat(endReason(a)).isEqualTo("ALL_ANSWERED");
        assertThat(groupEnds.endAfterDone(group.groupId(), a)).isFalse();
        assertThat(sessions.findById(b).orElseThrow().getStatus())
                .isEqualTo(SessionStatus.IN_PROGRESS);
        verify(rooms).removeGroupParticipant(group.groupId(), a);
    }

    // 6.5 · 6.14: 보내지 못한 면접방 정보와 채팅 답변은 마감 처리기가 다시 보내고, 보낸 뒤에는 다시 보내지 않는다
    @Test
    void failedRoomInfoAndAnswerAreResentUntilDelivered() throws Exception {
        ReadyGroup group = readyGroup(2, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        Map<Long, Long> users = usersBySession(group);
        long a = sessionIdsByTurnOrder(group.groupId()).get(0);
        // 면접방을 열 때 넣은 정보는 보낸 것으로 남긴다
        assertThat(roomVersion(group.groupId())).isEqualTo(turnVersion(group.groupId()));

        handle(questionStarted(a, 1, turnVersion(group.groupId())));
        handle(questionSpoken(a, 1, turnVersion(group.groupId())));
        mvc.perform(chatAnswerRequest(users.get(a), a, questionId(a, 1), "답변"))
                .andExpect(status().isAccepted());
        // 가짜 면접방은 false(보내기 실패)를 돌려준다
        assertThat(roomVersion(group.groupId())).isLessThan(turnVersion(group.groupId()));

        when(rooms.updateGroupInfo(eq(group.groupId()), anyString())).thenReturn(true);
        when(rooms.sendGroupAnswer(eq(group.groupId()), anyString())).thenReturn(true);
        deadlines.tick(OffsetDateTime.now());
        assertThat(roomVersion(group.groupId())).isEqualTo(turnVersion(group.groupId()));
        verify(rooms, times(2)).sendGroupAnswer(eq(group.groupId()), anyString());

        deadlines.tick(OffsetDateTime.now());
        verify(rooms, times(2)).sendGroupAnswer(eq(group.groupId()), anyString());

        // 이전 버전 보내기가 늦게 끝나면 더 새 정보를 덮어썼을 수 있어 다시 보내게 낮춘다
        int latest = turnVersion(group.groupId());
        groups.markRoomVersion(group.groupId(), latest - 1);
        assertThat(roomVersion(group.groupId())).isEqualTo(latest - 1);
        deadlines.tick(OffsetDateTime.now());
        assertThat(roomVersion(group.groupId())).isEqualTo(latest);
    }

    // 6.9: 답변 중 나가면 차례를 건너뛰고 질문은 닫지 않는다. 돌아오면 지금 차례가 끝난 뒤 순서가 지난 자기 질문을 같은 seq로 다시 받는다
    @Test
    void answererLeavingSkipsTurnAndGetsSameQuestionAfterReturning() throws Exception {
        ReadyGroup group = readyGroup(3, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        Map<Long, Long> users = usersBySession(group);
        List<Long> order = sessionIdsByTurnOrder(group.groupId());
        long a = order.get(0);
        long b = order.get(1);
        long c = order.get(2);
        handle(questionStarted(a, 1, turnVersion(group.groupId())));
        handle(questionSpoken(a, 1, turnVersion(group.groupId())));

        OffsetDateTime firstAsked = askedAt(questionId(a, 1));
        assertThat(absences.left(group.groupId(), a, OffsetDateTime.now())).isTrue();
        assertThat(absences.left(group.groupId(), a, OffsetDateTime.now())).isFalse();
        assertTurn(group.groupId(), 1, b, 1, "COMMON", "FULL");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT closed_at IS NULL AND interrupted_at IS NOT NULL FROM"
                                        + " interview_questions WHERE id = ?",
                                Boolean.class,
                                questionId(a, 1)))
                .isTrue();
        JsonNode info = lastRoomInfo(group.groupId());
        assertThat(info.path("participants").get(0).path("state").asString()).isEqualTo("ABSENT");
        assertThat(info.path("participants").get(0).path("absentUntil").isNull()).isFalse();
        assertThat(info.path("upcoming").size()).isEqualTo(1);
        // 나간 사람의 늦은 답변은 받지 않는다
        assertThat(handle(answerCompleted(a, 1, turnVersion(group.groupId()))))
                .isEqualTo(Outcome.DISCARDED);

        assertThat(absences.returned(group.groupId(), a, OffsetDateTime.now())).isTrue();
        assertTurn(group.groupId(), 1, b, 1, "COMMON", "FULL");
        assertThat(
                        lastRoomInfo(group.groupId())
                                .path("participants")
                                .get(0)
                                .path("state")
                                .asString())
                .isEqualTo("PRESENT");

        chatTurn(group.groupId(), users.get(b), b, 1, false);
        assertTurn(group.groupId(), 1, a, 1, "COMMON", "CALL");
        assertThat(handle(questionStarted(a, 1, turnVersion(group.groupId()))))
                .isEqualTo(Outcome.SAVED);
        assertThat(groupRow(group.groupId()).get("phase")).isEqualTo("SPEAKING");
        assertThat(questionKinds(a)).hasSize(1);
        // 다시 물은 시각이 질문을 낸 시각이고, 녹화 구간도 거기서 다시 시작한다(6.12)
        assertThat(askedAt(questionId(a, 1))).isAfter(firstAsked);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT interrupted_at IS NULL FROM interview_questions WHERE id ="
                                        + " ?",
                                Boolean.class,
                                questionId(a, 1)))
                .isTrue();
        handle(questionSpoken(a, 1, turnVersion(group.groupId())));
        mvc.perform(chatAnswerRequest(users.get(a), a, questionId(a, 1), "다시 답변"))
                .andExpect(status().isAccepted());
        handle(followupDecided(a, 1, turnVersion(group.groupId()), false));
        assertTurn(group.groupId(), 1, c, 1, "COMMON", "CALL");
    }

    // 6.9: 남은 질문이 나간 사람 것뿐이면 기다리고(WAITING), 돌아오면 이어 간다. 2분 안에만 다시 들어올 수 있고 지나면 DISCONNECTED로 끝난다
    @Test
    void waitingForAbsentParticipantUntilReturnOrDisconnect() throws Exception {
        ReadyGroup group = readyGroup(2, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        Map<Long, Long> users = usersBySession(group);
        List<Long> order = sessionIdsByTurnOrder(group.groupId());
        long a = order.get(0);
        long b = order.get(1);
        absences.left(group.groupId(), b, OffsetDateTime.now());
        mvc.perform(endRequest(users.get(a), a)).andExpect(status().isOk());
        assertThat(groupRow(group.groupId()).get("phase")).isEqualTo("WAITING");
        assertThat(lastRoomInfo(group.groupId()).path("turn").isNull()).isTrue();

        mvc.perform(as(users.get(b), post("/api/v1/interview-sessions/" + b + "/room-token")))
                .andExpect(status().isOk());
        absences.returned(group.groupId(), b, OffsetDateTime.now());
        assertTurn(group.groupId(), 1, b, 1, "COMMON", "FULL");

        // 질문을 시작하기 전에 다시 나가면 다시 기다린다
        absences.left(group.groupId(), b, OffsetDateTime.now());
        assertThat(groupRow(group.groupId()).get("phase")).isEqualTo("WAITING");
        jdbc.update(
                "UPDATE interview_group_participants SET absent_since = now() - interval '3"
                        + " minutes' WHERE session_id = ?",
                b);
        mvc.perform(as(users.get(b), post("/api/v1/interview-sessions/" + b + "/room-token")))
                .andExpect(status().isConflict());
        deadlines.tick(OffsetDateTime.now());
        assertThat(endReason(b)).isEqualTo("DISCONNECTED");
        assertThat(groupStatus(group.groupId())).isEqualTo("ENDED");
        verify(rooms).closeGroup(group.groupId());
    }

    // 6.9 · 6.11: 면접관이 나가면 AI 장애다. 같은 웹훅 이벤트는 한 번만 처리한다
    @Test
    void webhookEventsAreHandledOnceAndInterviewerLeavingIsAiFailure() throws Exception {
        ReadyGroup group = readyGroup(2, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        long a = sessionIdsByTurnOrder(group.groupId()).get(0);
        long b = sessionIdsByTurnOrder(group.groupId()).get(1);
        String eventId = "test-" + UUID.randomUUID();
        GroupRoomEvent left =
                new GroupRoomEvent(eventId, GroupRoomEvent.Type.LEFT, group.groupId(), b);
        try {
            absences.handle(left);
            assertThat(absentSince(b)).isNotNull();
            absences.returned(group.groupId(), b, OffsetDateTime.now());
            absences.handle(left);
            assertThat(absentSince(b)).isNull();
        } finally {
            redis.delete("livekit-webhook:" + eventId);
        }

        handle(questionStarted(a, 1, turnVersion(group.groupId())));
        String interviewerLeft = "test-" + UUID.randomUUID();
        try {
            absences.handle(
                    new GroupRoomEvent(
                            interviewerLeft, GroupRoomEvent.Type.LEFT, group.groupId(), null));
        } finally {
            redis.delete("livekit-webhook:" + interviewerLeft);
        }
        assertThat(groupStatus(group.groupId())).isEqualTo("ENDED");
        assertThat(endReason(a)).isEqualTo("AI_FAILURE");
        assertThat(endReason(b)).isEqualTo("AI_FAILURE");
        // 서명이 없는 웹훅은 받지 않는다
        mvc.perform(post("/api/v1/webhooks/livekit").content("{}"))
                .andExpect(status().isUnauthorized());
    }

    // 6.9: 웹훅이 빠져도 면접방 참가자 조회로 이탈 · 재입장 · 면접관 퇴장을 맞춘다. 막 시작한 그룹은 아직 들어오는 중이라 보지 않는다
    @Test
    void presenceCheckMatchesLiveKitParticipants() throws Exception {
        ReadyGroup group = readyGroup(2, "CHAT");
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        long a = sessionIdsByTurnOrder(group.groupId()).get(0);
        long b = sessionIdsByTurnOrder(group.groupId()).get(1);
        when(rooms.groupPresence(group.groupId()))
                .thenReturn(Optional.of(new GroupPresence(true, Set.of(a))));

        absences.reconcile(OffsetDateTime.now());
        assertThat(absentSince(b)).isNull();
        absences.reconcile(OffsetDateTime.now().plusMinutes(1));
        assertThat(absentSince(b)).isNotNull();

        when(rooms.groupPresence(group.groupId()))
                .thenReturn(Optional.of(new GroupPresence(true, Set.of(a, b))));
        absences.reconcile(OffsetDateTime.now().plusMinutes(1));
        assertThat(absentSince(b)).isNull();

        // 첫 질문 전에 면접관이 없으면 시작 실패다
        when(rooms.groupPresence(group.groupId()))
                .thenReturn(Optional.of(new GroupPresence(false, Set.of(a, b))));
        absences.reconcile(OffsetDateTime.now().plusMinutes(1));
        assertThat(groupStatus(group.groupId())).isEqualTo("START_FAILED");
    }

    private OffsetDateTime askedAt(long questionId) {
        return jdbc.queryForObject(
                "SELECT created_at FROM interview_questions WHERE id = ?",
                OffsetDateTime.class,
                questionId);
    }

    private OffsetDateTime absentSince(long sessionId) {
        return jdbc.queryForObject(
                "SELECT absent_since FROM interview_group_participants WHERE session_id = ?",
                OffsetDateTime.class,
                sessionId);
    }

    // 6.10 · 6.12: 화상 그룹은 그룹이 끝날 때 결과가 나오는 면접마다 녹화 합치기 작업을 넣는다. 작업에는 이번 시작 시도의 그룹 녹화 위치 · 내 참가자
    // 이름 · 본인 답변 구간을 담고, 다시보기는 구간 목록을 주며 그룹이 끝나기 전에는 합치는 중이다
    @Test
    void videoGroupMergesRecordingsWithOwnSegmentsWhenGroupEnds() throws Exception {
        ReadyGroup group = readyGroup(2);
        mvc.perform(startRequest(group.host(), group.groupId())).andExpect(status().isOk());
        Map<Long, Long> users = usersBySession(group);
        List<Long> order = sessionIdsByTurnOrder(group.groupId());
        long a = order.get(0);
        long b = order.get(1);
        handle(questionStarted(a, 1, turnVersion(group.groupId())));
        handle(questionSpoken(a, 1, turnVersion(group.groupId())));
        assertThat(handle(answerCompleted(a, 1, turnVersion(group.groupId()))))
                .isEqualTo(Outcome.SAVED);
        handle(followupDecided(a, 1, turnVersion(group.groupId()), false));

        mvc.perform(endRequest(users.get(a), a)).andExpect(status().isAccepted());
        assertThat(jobTypes(a)).doesNotContain("MERGE_RECORDING");
        jdbc.update("UPDATE interview_sessions SET status = 'COMPLETED' WHERE id = ?", a);
        ReplayResponse waiting = resultService.replay(users.get(a), a);
        assertThat(waiting.videoStatus()).isEqualTo(VideoStatus.MERGING);
        assertThat(waiting.segments()).extracting(ReplaySegment::seq).containsExactly(1);

        // 답변이 없는 b는 결과가 없어 합치지 않는다
        mvc.perform(endRequest(users.get(b), b)).andExpect(status().isOk());
        assertThat(groupStatus(group.groupId())).isEqualTo("ENDED");
        assertThat(jobTypes(a)).contains("MERGE_RECORDING");
        assertThat(jobTypes(b)).doesNotContain("MERGE_RECORDING");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT status FROM recordings WHERE session_id = ?",
                                String.class,
                                a))
                .isEqualTo("MERGING");

        UUID jobId =
                jdbc.queryForObject(
                        "SELECT id FROM ai_job_outbox WHERE session_id = ? AND job_type ="
                                + " 'MERGE_RECORDING'",
                        UUID.class,
                        a);
        JsonNode message =
                json.valueToTree(
                        transactions.execute(
                                status ->
                                        jobMessages.of(
                                                aiJobRepository.findById(jobId).orElseThrow())));
        OffsetDateTime startedAt = sessions.findById(a).orElseThrow().getStartedAt();
        assertThat(message.path("rawPrefix").asString())
                .isEqualTo(
                        "recordings/raw/group-"
                                + group.groupId()
                                + "/"
                                + startedAt.toInstant().toEpochMilli()
                                + "/");
        assertThat(message.path("roomName").asString()).isEqualTo("group-" + group.groupId());
        assertThat(message.path("candidateIdentity").asString()).isEqualTo("candidate-" + a);
        assertThat(message.path("objectKey").asString()).isEqualTo("recordings/" + a + ".mp4");
        assertThat(message.path("segments").size()).isEqualTo(1);
        JsonNode segment = message.path("segments").get(0);
        assertThat(OffsetDateTime.parse(segment.path("start").asString()))
                .isBefore(OffsetDateTime.parse(segment.path("end").asString()));
        assertThat(segment.path("start").asString())
                .matches(".*T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}\\+09:00");
    }

    private String rejected(long groupId, OffsetDateTime occurredAt) {
        return json.writeValueAsString(
                Map.of(
                        "type",
                        "assignment.rejected",
                        "groupId",
                        groupId,
                        "reason",
                        "INVALID_ASSIGNMENT",
                        "occurredAt",
                        occurredAt.toString()));
    }

    private int roomVersion(long groupId) {
        return jdbc.queryForObject(
                "SELECT room_version FROM interview_groups WHERE id = ?", Integer.class, groupId);
    }

    // 에이전트 결과를 차례대로 보내고 5.7로 답한다. 판단(DECIDING)을 거치는 차례만 쓴다
    private void chatTurn(long groupId, long userId, long sessionId, int seq, boolean followup)
            throws Exception {
        assertThat(handle(questionStarted(sessionId, seq, turnVersion(groupId))))
                .isEqualTo(Outcome.SAVED);
        assertThat(handle(questionSpoken(sessionId, seq, turnVersion(groupId))))
                .isEqualTo(Outcome.SAVED);
        mvc.perform(chatAnswerRequest(userId, sessionId, questionId(sessionId, seq), "답변 " + seq))
                .andExpect(status().isAccepted());
        assertThat(groupRow(groupId).get("phase")).isEqualTo("DECIDING");
        assertThat(handle(followupDecided(sessionId, seq, turnVersion(groupId), followup)))
                .isEqualTo(Outcome.SAVED);
    }

    private void assertTurn(
            long groupId, int round, long sessionId, int seq, String kind, String announce) {
        Map<String, Object> row = groupRow(groupId);
        assertThat(row.get("round")).isEqualTo(round);
        assertThat(row.get("phase")).isEqualTo("ASKING");
        assertThat(((Number) row.get("turn_session_id")).longValue()).isEqualTo(sessionId);
        assertThat(row.get("turn_seq")).isEqualTo(seq);
        assertThat(row.get("turn_kind")).isEqualTo(kind);
        assertThat(row.get("turn_announce")).isEqualTo(announce);
        // 면접방 정보도 같은 차례로 바꾼다
        JsonNode info = lastRoomInfo(groupId);
        assertThat(info.path("turnVersion").asInt()).isEqualTo(row.get("turn_version"));
        assertThat(info.path("turn").path("sessionId").asLong()).isEqualTo(sessionId);
    }

    private Outcome handle(String message) {
        return groupResults.handle(message);
    }

    private Map<String, Object> groupRow(long groupId) {
        return jdbc.queryForMap(
                "SELECT round, phase, turn_session_id, turn_seq, turn_kind, turn_announce,"
                        + " turn_version, deadline_at FROM interview_groups WHERE id = ?",
                groupId);
    }

    private int turnVersion(long groupId) {
        return (int) groupRow(groupId).get("turn_version");
    }

    // 면접방을 열 때(10.7) 또는 그 뒤에 마지막으로 보낸 면접방 정보
    private JsonNode lastRoomInfo(long groupId) {
        String metadata = null;
        for (Invocation call : mockingDetails(rooms).getInvocations()) {
            String method = call.getMethod().getName();
            if (call.getArgument(0).equals(groupId) && method.equals("openGroup")) {
                metadata = call.getArgument(3);
            } else if (call.getArgument(0).equals(groupId) && method.equals("updateGroupInfo")) {
                metadata = call.getArgument(1);
            }
        }
        assertThat(metadata).isNotNull();
        return json.readTree(metadata);
    }

    private Map<Long, Long> usersBySession(ReadyGroup group) {
        Map<Long, Long> users = new HashMap<>();
        users.put(group.sessionIds().get(0), group.host());
        for (int i = 0; i < group.guests().size(); i++) {
            users.put(group.sessionIds().get(i + 1), group.guests().get(i));
        }
        return users;
    }

    private long questionId(long sessionId, int seq) {
        return jdbc.queryForObject(
                "SELECT id FROM interview_questions WHERE session_id = ? AND seq = ?",
                Long.class,
                sessionId,
                seq);
    }

    private List<String> questionKinds(long sessionId) {
        return jdbc.queryForList(
                "SELECT kind FROM interview_questions WHERE session_id = ? ORDER BY seq",
                String.class,
                sessionId);
    }

    private OffsetDateTime doneAt(long sessionId) {
        return jdbc.queryForObject(
                "SELECT done_at FROM interview_group_participants WHERE session_id = ?",
                OffsetDateTime.class,
                sessionId);
    }

    private String questionStarted(long sessionId, int seq, int turnVersion) {
        return json.writeValueAsString(
                Map.of(
                        "type",
                        "question.started",
                        "sessionId",
                        sessionId,
                        "seq",
                        seq,
                        "turnVersion",
                        turnVersion,
                        "speechMs",
                        3000,
                        "startedAt",
                        OffsetDateTime.now().toString(),
                        "content",
                        "질문 " + seq,
                        "criteria",
                        "기준"));
    }

    private String questionSpoken(long sessionId, int seq, int turnVersion) {
        return json.writeValueAsString(
                Map.of(
                        "type",
                        "question.spoken",
                        "sessionId",
                        sessionId,
                        "seq",
                        seq,
                        "turnVersion",
                        turnVersion,
                        "endedAt",
                        OffsetDateTime.now().toString(),
                        "speech",
                        "ENDED"));
    }

    private String answerCompleted(long sessionId, int seq, int turnVersion) {
        return json.writeValueAsString(
                Map.of(
                        "type",
                        "answer.completed",
                        "sessionId",
                        sessionId,
                        "seq",
                        seq,
                        "turnVersion",
                        turnVersion,
                        "content",
                        "화상 답변",
                        "answerStartedAt",
                        OffsetDateTime.now().minusSeconds(30).toString(),
                        "answerEndedAt",
                        OffsetDateTime.now().toString(),
                        "endReason",
                        "AUTO_SUBMIT"));
    }

    private String followupDecided(long sessionId, int seq, int turnVersion, boolean needed) {
        Map<String, Object> message = new HashMap<>();
        message.put("type", "followup.decided");
        message.put("sessionId", sessionId);
        message.put("seq", seq);
        message.put("turnVersion", turnVersion);
        message.put("needed", needed);
        if (needed) {
            message.put("content", "꼬리질문");
            message.put("criteria", "기준");
        }
        return json.writeValueAsString(message);
    }

    private MockHttpServletRequestBuilder chatAnswerRequest(
            long userId, long sessionId, long questionId, String content) {
        String path = "/api/v1/interview-sessions/" + sessionId + "/questions/" + questionId;
        return as(userId, idempotent(post(path + "/answer")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("inputType", "TEXT", "content", content)));
    }

    private MockHttpServletRequestBuilder draftRequest(
            long userId, long sessionId, long questionId, String content) {
        String path = "/api/v1/interview-sessions/" + sessionId + "/questions/" + questionId;
        return as(userId, put(path + "/draft"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(json.writeValueAsString(Map.of("content", content)));
    }

    private MockHttpServletRequestBuilder extendRequest(long userId, long groupId) {
        return as(userId, post("/api/v1/interview-groups/" + groupId + "/turn/extend"));
    }

    private ReadyGroup readyGroup(int capacity) throws Exception {
        return readyGroup(capacity, "VIDEO");
    }

    private ReadyGroup readyGroup(int capacity, String mode) throws Exception {
        long host = newUser("방장");
        JsonNode group =
                read(
                        mvc.perform(createRequest(host, newApplication(host), capacity, mode))
                                .andExpect(status().isCreated()));
        long groupId = group.path("groupId").asLong();
        List<Long> guests = new ArrayList<>();
        for (int i = 1; i < capacity; i++) {
            long guest = newUser("손님" + i);
            join(guest, group.path("inviteCode").asString());
            guests.add(guest);
        }
        List<Long> ids = sessionIds(groupId);
        for (long sessionId : ids) {
            results.handle(planCompleted(sessionId, 2));
        }
        mvc.perform(readyRequest(host, groupId, true)).andExpect(status().isOk());
        for (long guest : guests) {
            mvc.perform(readyRequest(guest, groupId, true)).andExpect(status().isOk());
        }
        return new ReadyGroup(groupId, host, guests, ids);
    }

    /**
     * @param sessionIds 들어온 순서(방장이 처음)
     */
    private record ReadyGroup(long groupId, long host, List<Long> guests, List<Long> sessionIds) {}

    // 들어온 순서(방장이 처음)
    private List<Long> sessionIds(long groupId) {
        return jdbc.queryForList(
                "SELECT session_id FROM interview_group_participants WHERE group_id = ? AND"
                        + " left_at IS NULL ORDER BY joined_at, id",
                Long.class,
                groupId);
    }

    private List<Long> sessionIdsByTurnOrder(long groupId) {
        return jdbc.queryForList(
                "SELECT session_id FROM interview_group_participants WHERE group_id = ? AND"
                        + " left_at IS NULL ORDER BY turn_order",
                Long.class,
                groupId);
    }

    private String commonQuestionsOf(long groupId) {
        return jdbc.queryForObject(
                "SELECT common_questions::text FROM interview_groups WHERE id = ?",
                String.class,
                groupId);
    }

    private MockHttpServletRequestBuilder startRequest(long userId, long groupId) {
        return as(userId, idempotent(post("/api/v1/interview-groups/" + groupId + "/start")));
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
        return createRequest(userId, applicationId, capacity, "VIDEO");
    }

    private MockHttpServletRequestBuilder createRequest(
            long userId, long applicationId, int capacity, String mode) {
        return as(userId, idempotent(post("/api/v1/interview-groups")))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        json.writeValueAsString(
                                Map.of(
                                        "mode", mode,
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

    private MockHttpServletRequestBuilder endRequest(long userId, long sessionId) {
        return as(userId, idempotent(post("/api/v1/interview-sessions/" + sessionId + "/end")))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{}");
    }

    // 에이전트가 1번 질문을 내고 답변을 저장한 것처럼 만든다
    private void answered(long sessionId) {
        InterviewSession session = sessions.findById(sessionId).orElseThrow();
        InterviewQuestion question =
                questions.saveAndFlush(
                        new InterviewQuestion(
                                session, 1, "질문", "기준", null, null, OffsetDateTime.now()));
        answers.saveAndFlush(new Answer(question, InputType.TEXT, "답"));
    }

    private String endReason(long sessionId) {
        return jdbc.queryForObject(
                "SELECT end_reason FROM interview_sessions WHERE id = ?", String.class, sessionId);
    }

    private List<String> jobTypes(long sessionId) {
        return jdbc.queryForList(
                "SELECT job_type FROM ai_job_outbox WHERE session_id = ?", String.class, sessionId);
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
