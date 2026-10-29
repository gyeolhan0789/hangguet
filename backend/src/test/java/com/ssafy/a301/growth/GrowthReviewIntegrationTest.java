package com.ssafy.a301.growth;

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
import com.ssafy.a301.practice.domain.PracticeLog;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/** 7.1·7.2 성장 리뷰. 로컬은 docker compose의 PostgreSQL이 필요하다. */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class GrowthReviewIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private EntityManager em;

    private User user;

    /**
     * 19일: 첫 결과. 20일: 분석 실패만. 21일: 결과 완료 2건(23:50 시작해 22일에 끝난 면접 포함)과 분석 중 1건. 다른 회원의 21일 결과는 섞이지
     * 않아야 한다.
     */
    @BeforeEach
    void setUp() {
        user = user("owner");
        Application first = application(user, "○○전자");
        Application second = application(user, "△△소프트");

        InterviewSession day19 =
                practice(user, first, SessionStatus.COMPLETED, at("2026-10-19T09:00"), 10);
        scores(day19, 60, 70, 70, 60, "19일 코멘트");

        practice(user, first, SessionStatus.FAILED, at("2026-10-20T09:00"), 10);

        InterviewSession morning =
                practice(user, first, SessionStatus.COMPLETED, at("2026-10-21T10:00"), 30);
        em.persist(new SessionScore(morning, Criterion.JOB_FIT, 70, "아침 직무"));
        em.persist(new SessionScore(morning, Criterion.COVER_LETTER, 80, "아침 자소서"));
        em.persist(new SessionScore(morning, Criterion.LOGIC, 81, "아침 논리"));
        em.persist(new SessionScore(morning, Criterion.DELIVERY, 50, " "));
        answer(morning, 2, 55, "근거부터 말하기");
        practice(user, first, SessionStatus.ANALYZING, at("2026-10-21T12:00"), 5);
        InterviewSession night =
                practice(user, second, SessionStatus.COMPLETED, at("2026-10-21T23:50"), 20);
        scores(night, 81, 80, 80, 70, "밤");
        answer(night, 2, 55, "수치로 말하기");

        for (String date :
                new String[] {
                    "2026-10-14", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-23"
                }) {
            em.persist(new PracticeLog(user, LocalDate.parse(date)));
        }

        User other = user("other");
        InterviewSession others =
                practice(
                        other,
                        application(other, "□□은행"),
                        SessionStatus.COMPLETED,
                        at("2026-10-21T11:00"),
                        10);
        scores(others, 10, 10, 10, 10, "남의 코멘트");
        em.flush();
        em.clear();
    }

    @Test
    void reviewAveragesSameDayResultsAndComparesWithPreviousReviewDay() throws Exception {
        mvc.perform(as(user.getId(), get("/api/v1/growth-reviews/2026-10-21")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.practiceDate").value("2026-10-21"))
                .andExpect(jsonPath("$.isFirst").value(false))
                .andExpect(jsonPath("$.comparedDate").value("2026-10-19"))
                .andExpect(jsonPath("$.streakOnDate").value(3))
                .andExpect(jsonPath("$.practiceDates.length()").value(3))
                .andExpect(jsonPath("$.practiceDates[0]").value("2026-10-19"))
                .andExpect(jsonPath("$.interviewCount").value(3))
                .andExpect(jsonPath("$.practiceMinutes").value(55))
                .andExpect(jsonPath("$.criteria.length()").value(4))
                .andExpect(jsonPath("$.criteria[0].criterion").value("JOB_FIT"))
                .andExpect(jsonPath("$.criteria[0].score").value(76))
                .andExpect(jsonPath("$.criteria[0].grade").value("NORMAL"))
                .andExpect(jsonPath("$.criteria[0].delta").value(16))
                .andExpect(jsonPath("$.criteria[0].comment").value("밤"))
                .andExpect(jsonPath("$.criteria[2].score").value(81))
                .andExpect(jsonPath("$.criteria[2].grade").value("GOOD"))
                .andExpect(jsonPath("$.criteria[3].score").value(60))
                .andExpect(jsonPath("$.criteria[3].delta").value(0))
                // 그날 마지막 면접(밤)의 summary. 앞선 면접은 결과 생성 때 summary에 반영돼 있다(AI 명세 4장)
                .andExpect(jsonPath("$.nextActions.length()").value(1))
                .andExpect(jsonPath("$.nextActions[0]").value("2026-10-21T23:50 다음에 해볼 것"));
    }

    @Test
    void firstReviewDayHasNoComparison() throws Exception {
        mvc.perform(as(user.getId(), get("/api/v1/growth-reviews/2026-10-19")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isFirst").value(true))
                .andExpect(jsonPath("$.comparedDate").isEmpty())
                .andExpect(jsonPath("$.streakOnDate").value(1))
                .andExpect(jsonPath("$.criteria[0].delta").isEmpty())
                .andExpect(jsonPath("$.criteria[0].comment").value("19일 코멘트"))
                .andExpect(jsonPath("$.nextActions.length()").value(1))
                .andExpect(jsonPath("$.nextActions[0]").value("2026-10-19T09:00 다음에 해볼 것"));
    }

    @Test
    void dayWithoutCompletedResultIsNotFound() throws Exception {
        // 분석 실패만 있는 날, 자정을 넘겨 끝난 날, 기록 없는 날
        for (String date :
                new String[] {
                    "2026-10-20",
                    "2026-10-22",
                    "2026-10-23",
                    "2026-10-01",
                    "0001-01-01",
                    "9999-12-31"
                }) {
            mvc.perform(as(user.getId(), get("/api/v1/growth-reviews/" + date)))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("GROWTH_REVIEW_NOT_FOUND"));
        }
    }

    @Test
    void recentListsReviewDaysWithMostImprovedCriterion() throws Exception {
        mvc.perform(as(user.getId(), get("/api/v1/growth-reviews")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].practiceDate").value("2026-10-21"))
                .andExpect(jsonPath("$.content[0].companyName").value("△△소프트"))
                .andExpect(jsonPath("$.content[0].criterion").value("JOB_FIT"))
                .andExpect(jsonPath("$.content[0].delta").value(16))
                .andExpect(jsonPath("$.content[1].practiceDate").value("2026-10-19"))
                .andExpect(jsonPath("$.content[1].criterion").isEmpty())
                .andExpect(jsonPath("$.content[1].delta").isEmpty())
                .andExpect(jsonPath("$.page.totalElements").value(2));
        mvc.perform(
                        as(
                                user.getId(),
                                get("/api/v1/growth-reviews")
                                        .param("page", "1")
                                        .param("size", "1")))
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].practiceDate").value("2026-10-19"))
                .andExpect(jsonPath("$.page.totalPages").value(2));
        mvc.perform(as(user.getId(), get("/api/v1/growth-reviews").param("page", "5")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.page.totalElements").value(2));
    }

    @Test
    void incompleteResultIsSkippedWithoutBreakingOtherReviews() throws Exception {
        User owner = user("incomplete");
        Application application = application(owner, "○○전자");
        // 18일: 기준 점수가 2개뿐인 면접만 있음 → 리뷰 없음
        InterviewSession broken =
                practice(owner, application, SessionStatus.COMPLETED, at("2026-10-18T09:00"), 10);
        em.persist(new SessionScore(broken, Criterion.JOB_FIT, 10, "불완전"));
        em.persist(new SessionScore(broken, Criterion.LOGIC, 10, "불완전"));
        // 19일: 정상 면접 하나 + 기준 점수가 3개뿐인 면접 하나 → 정상 면접만 점수에 들어간다
        InterviewSession complete =
                practice(owner, application, SessionStatus.COMPLETED, at("2026-10-19T09:00"), 10);
        scores(complete, 80, 80, 80, 80, "정상");
        InterviewSession partial =
                practice(owner, application, SessionStatus.COMPLETED, at("2026-10-19T10:00"), 10);
        em.persist(new SessionScore(partial, Criterion.JOB_FIT, 0, "불완전"));
        em.persist(new SessionScore(partial, Criterion.COVER_LETTER, 0, "불완전"));
        em.persist(new SessionScore(partial, Criterion.LOGIC, 0, "불완전"));
        em.flush();
        em.clear();

        mvc.perform(as(owner.getId(), get("/api/v1/growth-reviews/2026-10-18")))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROWTH_REVIEW_NOT_FOUND"));
        mvc.perform(as(owner.getId(), get("/api/v1/growth-reviews/2026-10-19")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.isFirst").value(true))
                .andExpect(jsonPath("$.criteria[0].score").value(80))
                .andExpect(jsonPath("$.criteria[0].comment").value("정상"))
                // 기준 점수가 불완전한 면접(10시)은 빼고 정상 면접(9시)의 summary를 준다
                .andExpect(jsonPath("$.nextActions[0]").value("2026-10-19T09:00 다음에 해볼 것"));
        mvc.perform(as(owner.getId(), get("/api/v1/growth-reviews")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].practiceDate").value("2026-10-19"));
    }

    @Test
    void recentShowsDeliveryZeroWhenNothingImprovedAndNothingOnFirstDay() throws Exception {
        User owner = user("no-improvement");
        Application application = application(owner, "○○전자");
        scores(
                practice(owner, application, SessionStatus.COMPLETED, at("2026-10-19T09:00"), 10),
                80,
                80,
                80,
                80,
                "19일");
        // 20일: 모두 떨어짐, 21일: 모두 그대로
        scores(
                practice(owner, application, SessionStatus.COMPLETED, at("2026-10-20T09:00"), 10),
                70,
                75,
                79,
                60,
                "20일");
        scores(
                practice(owner, application, SessionStatus.COMPLETED, at("2026-10-21T09:00"), 10),
                70,
                75,
                79,
                60,
                "21일");
        em.flush();
        em.clear();

        mvc.perform(as(owner.getId(), get("/api/v1/growth-reviews").param("size", "5")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(3))
                // 오른 기준이 없으면(그대로 · 모두 떨어짐) 전달력 +0
                .andExpect(jsonPath("$.content[0].practiceDate").value("2026-10-21"))
                .andExpect(jsonPath("$.content[0].criterion").value("DELIVERY"))
                .andExpect(jsonPath("$.content[0].delta").value(0))
                .andExpect(jsonPath("$.content[1].practiceDate").value("2026-10-20"))
                .andExpect(jsonPath("$.content[1].criterion").value("DELIVERY"))
                .andExpect(jsonPath("$.content[1].delta").value(0))
                // 첫 연습일은 비교할 날이 없어 null
                .andExpect(jsonPath("$.content[2].practiceDate").value("2026-10-19"))
                .andExpect(jsonPath("$.content[2].criterion").isEmpty())
                .andExpect(jsonPath("$.content[2].delta").isEmpty());
        // 7.1의 기준별 delta는 떨어져도 그대로 준다
        mvc.perform(as(owner.getId(), get("/api/v1/growth-reviews/2026-10-20")))
                .andExpect(jsonPath("$.criteria[0].delta").value(-10))
                .andExpect(jsonPath("$.criteria[2].delta").value(-1));
    }

    @Test
    void recentIsEmptyWithoutResults() throws Exception {
        User empty = user("empty");
        em.flush();

        mvc.perform(as(empty.getId(), get("/api/v1/growth-reviews")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.page.totalElements").value(0));
    }

    private User user(String name) {
        User created =
                new User("growth-" + name + "-" + UUID.randomUUID() + "@example.com", "hash", name);
        em.persist(created);
        return created;
    }

    private Application application(User owner, String companyName) {
        Application application = new Application(owner, companyName, "백엔드 개발자");
        em.persist(application);
        return application;
    }

    private InterviewSession practice(
            User owner,
            Application application,
            SessionStatus status,
            OffsetDateTime startedAt,
            int minutes) {
        InterviewSession session =
                new InterviewSession(owner, application, Persona.DEVIL, InterviewMode.VIDEO);
        em.persist(session);
        session.start(startedAt);
        InterviewQuestion question = new InterviewQuestion(session, 1, "자기소개");
        em.persist(question);
        Answer answer = new Answer(question, InputType.VOICE, "답변");
        answer.evaluate(90, "좋아요", "높은 점수의 고칠 점");
        em.persist(answer);
        session.end(startedAt.plusMinutes(minutes), 1);
        if (status == SessionStatus.COMPLETED) {
            session.complete("총평", startedAt.toLocalDateTime() + " 다음에 해볼 것");
        } else if (status == SessionStatus.FAILED) {
            session.failAnalysis();
        }
        return session;
    }

    private void scores(
            InterviewSession session,
            int jobFit,
            int coverLetter,
            int logic,
            int delivery,
            String comment) {
        em.persist(new SessionScore(session, Criterion.JOB_FIT, jobFit, comment));
        em.persist(
                new SessionScore(session, Criterion.COVER_LETTER, coverLetter, comment + " 자소서"));
        em.persist(new SessionScore(session, Criterion.LOGIC, logic, comment + " 논리"));
        em.persist(new SessionScore(session, Criterion.DELIVERY, delivery, comment + " 전달"));
    }

    private void answer(InterviewSession session, int seq, int score, String improvePoint) {
        InterviewQuestion question = new InterviewQuestion(session, seq, "꼬리 질문");
        em.persist(question);
        Answer answer = new Answer(question, InputType.VOICE, "답변");
        answer.evaluate(score, "좋아요", improvePoint);
        em.persist(answer);
    }

    private static OffsetDateTime at(String koreaDateTime) {
        return OffsetDateTime.parse(koreaDateTime + ":00+09:00");
    }

    private static MockHttpServletRequestBuilder as(
            long userId, MockHttpServletRequestBuilder request) {
        return request.with(jwt().jwt(token -> token.subject(Long.toString(userId))));
    }
}
