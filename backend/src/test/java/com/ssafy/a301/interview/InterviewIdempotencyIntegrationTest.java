package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * 실제 Redis 멱등 저장소로 5.8 끝내기를 같은 키로 다시 보낸다(BE 설계 8장). 같은 요청이면 처음 응답을 그대로 받고 연습 기록·작업은 한 번만 남는다. 로컬은
 * docker compose의 PostgreSQL·Redis가 필요하다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(InMemorySessionRuntimeStore.Config.class)
class InterviewIdempotencyIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private UserRepository users;
    @Autowired private ApplicationRepository applications;
    @Autowired private InterviewSessionRepository sessions;
    @Autowired private InterviewQuestionRepository questions;
    @Autowired private AnswerRepository answers;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private StringRedisTemplate redis;
    @MockitoBean private AiJobQueue queue;
    @MockitoBean private InterviewRoom rooms;
    private final List<Long> userIds = new ArrayList<>();
    private final List<String> redisKeys = new ArrayList<>();

    @AfterEach
    void cleanup() {
        if (!redisKeys.isEmpty()) {
            redis.delete(redisKeys);
        }
        for (long id : userIds) {
            String sessionsOfUser = "SELECT id FROM interview_sessions WHERE user_id = " + id;
            jdbc.update(
                    "DELETE FROM answers WHERE question_id IN (SELECT id FROM interview_questions"
                            + " WHERE session_id IN ("
                            + sessionsOfUser
                            + "))");
            jdbc.update(
                    "DELETE FROM interview_questions WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM ai_job_outbox WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM practice_logs WHERE user_id = ?", id);
            jdbc.update("DELETE FROM interview_sessions WHERE user_id = ?", id);
            jdbc.update("DELETE FROM applications WHERE user_id = ?", id);
            jdbc.update("DELETE FROM users WHERE id = ?", id);
        }
    }

    @Test
    void sameKeyEndReplaysFirstResponseAndRecordsOnce() throws Exception {
        long user = newUser();
        long sessionId = answeredSession(user);
        UUID key = UUID.randomUUID();
        redisKeys.add("idem:" + user + ":" + key);
        String end = "/api/v1/interview-sessions/" + sessionId + "/end";

        String first =
                mvc.perform(as(user, post(end)).header("Idempotency-Key", key.toString()))
                        .andExpect(status().isAccepted())
                        .andExpect(jsonPath("$.status").value("ANALYZING"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        // 응답을 받지 못한 화면이 같은 키로 다시 보낸다
        String again =
                mvc.perform(as(user, post(end)).header("Idempotency-Key", key.toString()))
                        .andExpect(status().isAccepted())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        assertThat(again).isEqualTo(first);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM practice_logs WHERE user_id = ?",
                                Integer.class,
                                user))
                .isEqualTo(1);
        // 결과 생성 작업(Outbox)도 한 번만 생긴다
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM ai_job_outbox WHERE session_id = ? AND"
                                        + " job_type = 'EVALUATE'",
                                Integer.class,
                                sessionId))
                .isEqualTo(1);
    }

    @Test
    void sameKeyForAnotherRequestIsConflict() throws Exception {
        long user = newUser();
        long sessionId = answeredSession(user);
        long otherSessionId = answeredSession(user);
        UUID key = UUID.randomUUID();
        redisKeys.add("idem:" + user + ":" + key);

        mvc.perform(
                        as(user, post("/api/v1/interview-sessions/" + sessionId + "/end"))
                                .header("Idempotency-Key", key.toString()))
                .andExpect(status().isAccepted());
        mvc.perform(
                        as(user, post("/api/v1/interview-sessions/" + otherSessionId + "/end"))
                                .header("Idempotency-Key", key.toString()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("IDEMPOTENCY_KEY_REUSED"));
    }

    // 시작해서 1번 질문에 답한 채팅 면접
    private long answeredSession(long userId) {
        User user = users.getReferenceById(userId);
        Application application =
                applications.saveAndFlush(new Application(user, "○○전자", "백엔드 개발자"));
        InterviewSession session =
                new InterviewSession(user, application, Persona.DEVIL, InterviewMode.CHAT);
        session.start(OffsetDateTime.now().minusMinutes(5));
        session = sessions.saveAndFlush(session);
        InterviewQuestion question =
                questions.saveAndFlush(new InterviewQuestion(session, 1, "질문1"));
        answers.saveAndFlush(new Answer(question, InputType.TEXT, "답1"));
        return session.getId();
    }

    private long newUser() {
        long id =
                users.saveAndFlush(
                                new User(
                                        "idem-it-" + UUID.randomUUID() + "@example.com",
                                        "hash",
                                        "멱등 검증"))
                        .getId();
        userIds.add(id);
        return id;
    }

    private static MockHttpServletRequestBuilder as(
            long userId, MockHttpServletRequestBuilder request) {
        return request.with(jwt().jwt(token -> token.subject(Long.toString(userId))));
    }
}
