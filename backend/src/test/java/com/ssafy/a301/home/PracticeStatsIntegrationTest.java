package com.ssafy.a301.home;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.home.service.PracticeStatsService;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.practice.domain.PracticeLog;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/** 3.2 통계·3.3 연습 달력. 로컬은 docker compose의 PostgreSQL이 필요하다. */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class PracticeStatsIntegrationTest {
    private static final OffsetDateTime DAY_START =
            OffsetDateTime.parse("2026-10-21T00:00:00+09:00");

    @Autowired private MockMvc mvc;
    @Autowired private EntityManager em;
    @Autowired private PracticeStatsService service;

    @Test
    void statsCountsOnlyOwnPracticeSessionsWithWholeDuration() {
        User user = user("stats");
        Application old = application(user, "프론트엔드 개발자");
        Application latest = application(user, "백엔드 개발자");
        // 자정을 넘긴 면접도 전체 20분을 센다
        practice(
                user,
                old,
                SessionStatus.COMPLETED,
                OffsetDateTime.parse("2026-10-20T23:50:00+09:00"),
                OffsetDateTime.parse("2026-10-21T00:10:00+09:00"),
                true);
        practice(
                user,
                latest,
                SessionStatus.FAILED,
                DAY_START.plusHours(9),
                DAY_START.plusHours(9).plusSeconds(119),
                true);
        practice(
                user,
                old,
                SessionStatus.ANALYZING,
                DAY_START.plusHours(8),
                DAY_START.plusHours(8).plusSeconds(61),
                true);
        // 답변 없는 면접·중단·진행 중·다른 회원은 세지 않는다
        practice(
                user,
                old,
                SessionStatus.ANALYZING,
                DAY_START.plusHours(10),
                DAY_START.plusHours(11),
                false);
        InterviewSession aborted =
                new InterviewSession(user, old, Persona.DEVIL, InterviewMode.CHAT);
        em.persist(aborted);
        aborted.start(DAY_START.plusHours(12));
        aborted.end(DAY_START.plusHours(13), 0);
        InterviewSession active =
                new InterviewSession(user, old, Persona.DEVIL, InterviewMode.CHAT);
        em.persist(active);
        active.start(DAY_START.plusHours(14));
        InterviewQuestion activeQuestion = new InterviewQuestion(active, 1, "질문");
        em.persist(activeQuestion);
        em.persist(new Answer(activeQuestion, InputType.TEXT, "답변"));
        User other = user("other-stats");
        practice(
                other,
                application(other, "디자이너"),
                SessionStatus.COMPLETED,
                DAY_START.plusHours(20),
                DAY_START.plusHours(21),
                true);
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 20)));
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 21)));
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 1)));
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 2)));
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 3)));
        em.persist(new PracticeLog(other, LocalDate.of(2026, 10, 22)));
        em.flush();
        em.clear();

        var stats = service.stats(user.getId(), LocalDate.of(2026, 10, 22));

        assertThat(stats.currentStreak()).isEqualTo(2);
        assertThat(stats.bestStreak()).isEqualTo(3);
        assertThat(stats.totalInterviewCount()).isEqualTo(3);
        // 1200 + 119 + 61 = 1380초 = 23분
        assertThat(stats.totalPracticeMinutes()).isEqualTo(23);
        assertThat(stats.latestJobTitle()).isEqualTo("백엔드 개발자");
    }

    @Test
    void statsIsZeroAndNullWithoutRecords() throws Exception {
        User user = user("empty");
        em.flush();

        mvc.perform(as(user.getId(), get("/api/v1/users/me/stats")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentStreak").value(0))
                .andExpect(jsonPath("$.bestStreak").value(0))
                .andExpect(jsonPath("$.totalInterviewCount").value(0))
                .andExpect(jsonPath("$.totalPracticeMinutes").value(0))
                .andExpect(jsonPath("$.latestJobTitle").isEmpty());
    }

    @Test
    void practiceLogsReturnsOwnDaysInMonthOnly() throws Exception {
        User user = user("logs");
        User other = user("other-logs");
        em.persist(new PracticeLog(user, LocalDate.of(2026, 9, 30)));
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 21)));
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 1)));
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 31)));
        em.persist(new PracticeLog(user, LocalDate.of(2026, 11, 1)));
        em.persist(new PracticeLog(other, LocalDate.of(2026, 10, 15)));
        em.flush();

        mvc.perform(as(user.getId(), get("/api/v1/practice-logs").param("month", "2026-10")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(3))
                .andExpect(jsonPath("$.content[0].practiceDate").value("2026-10-01"))
                .andExpect(jsonPath("$.content[1].practiceDate").value("2026-10-21"))
                .andExpect(jsonPath("$.content[2].practiceDate").value("2026-10-31"))
                .andExpect(jsonPath("$.content[0].createdAt").isNotEmpty());
        mvc.perform(as(user.getId(), get("/api/v1/practice-logs").param("month", "2026-12")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty());
    }

    private User user(String name) {
        User user =
                new User("stats-" + name + "-" + UUID.randomUUID() + "@example.com", "hash", name);
        em.persist(user);
        return user;
    }

    private Application application(User user, String jobTitle) {
        Application application = new Application(user, "○○전자", jobTitle);
        em.persist(application);
        return application;
    }

    private void practice(
            User user,
            Application application,
            SessionStatus status,
            OffsetDateTime startedAt,
            OffsetDateTime endedAt,
            boolean withAnswer) {
        InterviewSession session =
                new InterviewSession(user, application, Persona.DEVIL, InterviewMode.VIDEO);
        em.persist(session);
        session.start(startedAt);
        InterviewQuestion question = new InterviewQuestion(session, 1, "자기소개");
        em.persist(question);
        if (withAnswer) {
            em.persist(new Answer(question, InputType.VOICE, "답변"));
        }
        session.end(endedAt, 1);
        if (status == SessionStatus.COMPLETED) {
            session.complete("총평", "다음에 해볼 것");
        } else if (status == SessionStatus.FAILED) {
            session.failAnalysis();
        }
    }

    private static MockHttpServletRequestBuilder as(
            long userId, MockHttpServletRequestBuilder request) {
        return request.with(jwt().jwt(token -> token.subject(Long.toString(userId))));
    }
}
