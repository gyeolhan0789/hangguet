package com.ssafy.a301.interview;

import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class InterviewSessionListIntegrationTest {
    private static final OffsetDateTime DAY_START =
            OffsetDateTime.parse("2026-10-21T00:00:00+09:00");

    @Autowired private MockMvc mvc;
    @Autowired private EntityManager em;

    @Test
    void calendarCountsSessionsOnceByKoreaStartDateAndFiltersLikeDailyList() throws Exception {
        User user = user("calendar");
        Application application = application(user);
        OffsetDateTime monthStart = OffsetDateTime.parse("2026-10-01T00:00:00+09:00");
        InterviewSession first =
                practice(
                        user,
                        application,
                        SessionStatus.COMPLETED,
                        monthStart.withOffsetSameInstant(java.time.ZoneOffset.UTC),
                        monthStart.plusMinutes(10),
                        true,
                        "총평");
        InterviewQuestion second = new InterviewQuestion(first, 2, "추가 질문");
        em.persist(second);
        em.persist(new Answer(second, InputType.VOICE, "추가 답변"));
        practice(
                user,
                application,
                SessionStatus.FAILED,
                monthStart.plusHours(1),
                monthStart.plusHours(1).plusMinutes(10),
                true,
                null);
        practice(
                user,
                application,
                SessionStatus.ANALYZING,
                monthStart.plusDays(30).plusHours(23),
                monthStart.plusMonths(1).plusMinutes(10),
                true,
                null);
        practice(
                user,
                application,
                SessionStatus.ANALYZING,
                monthStart.minusMinutes(1),
                monthStart.plusMinutes(10),
                true,
                null);
        practice(
                user,
                application,
                SessionStatus.ANALYZING,
                monthStart.plusMonths(1),
                monthStart.plusMonths(1).plusMinutes(10),
                true,
                null);
        practice(
                user,
                application,
                SessionStatus.ANALYZING,
                monthStart.plusDays(1),
                monthStart.plusDays(1).plusMinutes(10),
                false,
                null);
        InterviewSession active =
                new InterviewSession(user, application, Persona.DEVIL, InterviewMode.CHAT);
        em.persist(active);
        active.start(monthStart.plusDays(1));
        InterviewQuestion activeQuestion = new InterviewQuestion(active, 1, "질문");
        em.persist(activeQuestion);
        em.persist(new Answer(activeQuestion, InputType.TEXT, "답변"));
        InterviewSession aborted =
                new InterviewSession(user, application, Persona.DEVIL, InterviewMode.CHAT);
        em.persist(aborted);
        aborted.start(monthStart.plusDays(1));
        aborted.end(monthStart.plusDays(1).plusMinutes(1), 0);
        User other = user("other-calendar");
        practice(
                other,
                application(other),
                SessionStatus.COMPLETED,
                monthStart,
                monthStart.plusMinutes(10),
                true,
                "다른 회원");
        em.flush();
        em.clear();

        mvc.perform(
                        as(
                                user.getId(),
                                get("/api/v1/interview-sessions/calendar")
                                        .param("month", "2026-10")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.month").value("2026-10"))
                .andExpect(jsonPath("$.content.length()").value(31))
                .andExpect(jsonPath("$.content[0].practiceDate").value("2026-10-01"))
                .andExpect(jsonPath("$.content[0].interviewCount").value(2))
                .andExpect(jsonPath("$.content[1].interviewCount").value(0))
                .andExpect(jsonPath("$.content[30].practiceDate").value("2026-10-31"))
                .andExpect(jsonPath("$.content[30].interviewCount").value(1));

        user = em.find(User.class, user.getId());
        user.withdraw(monthStart.plusMonths(1));
        em.flush();
        mvc.perform(
                        as(
                                user.getId(),
                                get("/api/v1/interview-sessions/calendar")
                                        .param("month", "2026-10")))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath(
                                "$.content[*].interviewCount",
                                org.hamcrest.Matchers.everyItem(org.hamcrest.Matchers.is(0))));
    }

    @Test
    void listUsesKoreaStartDateAndExcludesOtherUsersAndSessionsWithoutAnswers() throws Exception {
        User user = user("owner");
        Application application = application(user);
        User other = user("other");
        Application otherApplication = application(other);

        InterviewSession completed =
                practice(
                        user,
                        application,
                        SessionStatus.COMPLETED,
                        DAY_START.plusMinutes(1),
                        DAY_START.plusMinutes(3),
                        true,
                        "결론이 명확해요");
        em.persist(new SessionScore(completed, Criterion.JOB_FIT, 85, "좋아요"));
        em.persist(new SessionScore(completed, Criterion.COVER_LETTER, 70, "보통"));
        em.persist(new SessionScore(completed, Criterion.LOGIC, 59, "보완해요"));
        em.persist(new SessionScore(completed, Criterion.DELIVERY, 70, "보통"));
        InterviewSession analyzing =
                practice(
                        user,
                        application,
                        SessionStatus.ANALYZING,
                        DAY_START.plusHours(12),
                        DAY_START.plusHours(12).plusSeconds(61),
                        true,
                        null);
        InterviewSession failed =
                practice(
                        user,
                        application,
                        SessionStatus.FAILED,
                        DAY_START.plusHours(13),
                        DAY_START.plusHours(13).plusSeconds(60),
                        true,
                        null);
        practice(
                user,
                application,
                SessionStatus.ANALYZING,
                DAY_START.plusHours(14),
                DAY_START.plusHours(14).plusMinutes(10),
                false,
                null);
        practice(
                other,
                otherApplication,
                SessionStatus.COMPLETED,
                DAY_START.plusHours(15),
                DAY_START.plusHours(15).plusMinutes(10),
                true,
                "남의 총평");
        practice(
                user,
                application,
                SessionStatus.COMPLETED,
                DAY_START.plusDays(1),
                DAY_START.plusDays(1).plusMinutes(5),
                true,
                "다른 날");
        em.flush();
        em.clear();

        mvc.perform(
                        as(
                                user.getId(),
                                get("/api/v1/interview-sessions")
                                        .param("practiceDate", "2026-10-21")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(3))
                .andExpect(jsonPath("$.content[0].id").value(failed.getId()))
                .andExpect(jsonPath("$.content[0].summary").isEmpty())
                .andExpect(jsonPath("$.content[0].criterionGrades").isEmpty())
                .andExpect(jsonPath("$.content[1].id").value(analyzing.getId()))
                .andExpect(jsonPath("$.content[1].answeredCount").value(1))
                .andExpect(jsonPath("$.content[2].id").value(completed.getId()))
                .andExpect(jsonPath("$.content[2].summary").value("결론이 명확해요"))
                .andExpect(jsonPath("$.content[2].criterionGrades[0].criterion").value("JOB_FIT"))
                .andExpect(jsonPath("$.content[2].criterionGrades[0].grade").value("GOOD"))
                .andExpect(jsonPath("$.content[2].criterionGrades.length()").value(4))
                .andExpect(jsonPath("$.content[2].criterionGrades[2].criterion").value("LOGIC"))
                .andExpect(jsonPath("$.content[2].criterionGrades[2].grade").value("WEAK"))
                .andExpect(jsonPath("$.page.totalElements").value(3))
                .andExpect(jsonPath("$.summary.totalInterviewCount").value(4))
                .andExpect(jsonPath("$.summary.practiceMinutes").value(4));
    }

    @Test
    void paginationSortsByStartTimeThenIdAndKeepsWholeDateAggregates() throws Exception {
        User user = user("paging");
        Application application = application(user);
        InterviewSession first =
                practice(
                        user,
                        application,
                        SessionStatus.ANALYZING,
                        DAY_START.plusHours(19).plusMinutes(59),
                        DAY_START.plusHours(20).plusMinutes(5),
                        true,
                        null);
        InterviewSession second =
                practice(
                        user,
                        application,
                        SessionStatus.ANALYZING,
                        DAY_START.plusHours(20),
                        DAY_START.plusHours(20).plusMinutes(1),
                        true,
                        null);
        InterviewSession third =
                practice(
                        user,
                        application,
                        SessionStatus.ANALYZING,
                        DAY_START.plusHours(20),
                        DAY_START.plusHours(20).plusMinutes(2),
                        true,
                        null);
        em.flush();
        em.clear();

        mvc.perform(
                        as(user.getId(), get("/api/v1/interview-sessions"))
                                .param("practiceDate", "2026-10-21")
                                .param("page", "0")
                                .param("size", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(third.getId()))
                .andExpect(jsonPath("$.content[1].id").value(second.getId()))
                .andExpect(jsonPath("$.page.totalElements").value(3))
                .andExpect(jsonPath("$.page.totalPages").value(2))
                .andExpect(jsonPath("$.summary.totalInterviewCount").value(3))
                .andExpect(jsonPath("$.summary.practiceMinutes").value(9));
        mvc.perform(
                        as(user.getId(), get("/api/v1/interview-sessions"))
                                .param("practiceDate", "2026-10-21")
                                .param("page", "1")
                                .param("size", "2"))
                .andExpect(jsonPath("$.content[0].id").value(first.getId()))
                .andExpect(jsonPath("$.page.totalElements").value(3))
                .andExpect(jsonPath("$.summary.practiceMinutes").value(9));
        mvc.perform(
                        as(user.getId(), get("/api/v1/interview-sessions"))
                                .param("practiceDate", "2026-10-21")
                                .param("page", String.valueOf(Integer.MAX_VALUE))
                                .param("size", "20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.page.totalElements").value(3))
                .andExpect(jsonPath("$.summary.practiceMinutes").value(9));
    }

    @Test
    void crossMidnightSessionBelongsOnlyToItsKoreaStartDate() throws Exception {
        User user = user("midnight");
        Application application = application(user);
        InterviewSession crossMidnight =
                practice(
                        user,
                        application,
                        SessionStatus.ANALYZING,
                        OffsetDateTime.parse("2026-10-21T23:50:00+09:00"),
                        OffsetDateTime.parse("2026-10-22T00:10:00+09:00"),
                        true,
                        null);
        em.flush();
        em.clear();

        mvc.perform(
                        as(
                                user.getId(),
                                get("/api/v1/interview-sessions")
                                        .param("practiceDate", "2026-10-21")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].id").value(crossMidnight.getId()))
                .andExpect(jsonPath("$.summary.practiceMinutes").value(20));

        mvc.perform(
                        as(
                                user.getId(),
                                get("/api/v1/interview-sessions")
                                        .param("practiceDate", "2026-10-22")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.summary.practiceMinutes").value(0));
    }

    @Test
    void listHandlesDateRangeBoundariesWithoutServerError() throws Exception {
        User user = user("boundary");
        em.flush();

        for (String date : new String[] {"0001-01-01", "9999-12-31"}) {
            mvc.perform(
                            as(
                                    user.getId(),
                                    get("/api/v1/interview-sessions").param("practiceDate", date)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.content").isEmpty());
        }
        mvc.perform(
                        as(
                                user.getId(),
                                get("/api/v1/interview-sessions")
                                        .param("practiceDate", "+999999999-12-31")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void withdrawnUserHasNoPracticeRecords() throws Exception {
        User user = user("withdrawn");
        Application application = application(user);
        practice(
                user,
                application,
                SessionStatus.COMPLETED,
                DAY_START.plusHours(1),
                DAY_START.plusHours(1).plusMinutes(5),
                true,
                "총평");
        user.withdraw(DAY_START.plusDays(2));
        em.flush();

        mvc.perform(
                        as(
                                user.getId(),
                                get("/api/v1/interview-sessions")
                                        .param("practiceDate", "2026-10-21")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.page.totalElements").value(0))
                .andExpect(jsonPath("$.summary.totalInterviewCount").value(0))
                .andExpect(jsonPath("$.summary.practiceMinutes").value(0));
    }

    private User user(String name) {
        User user =
                new User(
                        "records-" + name + "-" + UUID.randomUUID() + "@example.com", "hash", name);
        em.persist(user);
        return user;
    }

    private Application application(User user) {
        Application application = new Application(user, "○○전자", "백엔드 개발자", "자소서");
        em.persist(application);
        return application;
    }

    private InterviewSession practice(
            User user,
            Application application,
            SessionStatus status,
            OffsetDateTime startedAt,
            OffsetDateTime endedAt,
            boolean withAnswer,
            String summary) {
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
            session.complete(summary);
        } else if (status == SessionStatus.FAILED) {
            session.failAnalysis();
        }
        return session;
    }

    private static MockHttpServletRequestBuilder as(
            long userId, MockHttpServletRequestBuilder request) {
        return request.with(jwt().jwt(token -> token.subject(Long.toString(userId))));
    }
}
