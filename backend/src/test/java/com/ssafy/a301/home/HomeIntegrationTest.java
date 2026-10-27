package com.ssafy.a301.home;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.growth.dto.GrowthDtos.Improvement;
import com.ssafy.a301.home.dto.HomeDtos.HomeResponse;
import com.ssafy.a301.home.dto.HomeDtos.HomeState;
import com.ssafy.a301.home.service.HomeService;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.practice.domain.PracticeLog;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/** 3.1 홈. 오늘을 정해서 호출한다. 로컬은 docker compose의 PostgreSQL이 필요하다. */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class HomeIntegrationTest {
    private static final LocalDate OCT_19 = LocalDate.of(2026, 10, 19);
    private static final LocalDate OCT_20 = LocalDate.of(2026, 10, 20);
    private static final LocalDate OCT_21 = LocalDate.of(2026, 10, 21);

    @Autowired private MockMvc mvc;
    @Autowired private EntityManager em;
    @Autowired private HomeService home;

    @Test
    void firstVisitHasZerosAndEmptyArrays() throws Exception {
        User user = user("first");
        em.flush();

        mvc.perform(
                        get("/api/v1/home")
                                .with(jwt().jwt(token -> token.subject(user.getId().toString()))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.homeState").value("FIRST_VISIT"))
                .andExpect(jsonPath("$.currentStreak").value(0))
                .andExpect(jsonPath("$.bestStreak").value(0))
                .andExpect(jsonPath("$.practiceDates").isEmpty())
                .andExpect(jsonPath("$.todayInterviewCount").value(0))
                .andExpect(jsonPath("$.todayPracticeMinutes").value(0))
                .andExpect(jsonPath("$.todayImprovements").isEmpty())
                .andExpect(jsonPath("$.nextActions").isEmpty())
                .andExpect(jsonPath("$.nextActionsDate").isEmpty())
                .andExpect(jsonPath("$.recentReviews").isEmpty());
    }

    @Test
    void doneTodayShowsTodayImprovementsAndTodayReview() {
        User user = user("done");
        Application application = application(user, "○○전자");
        completed(user, application, at(OCT_19, 9), 10, 60, 70, 70, 60, "19일");
        completed(user, application, at(OCT_21, 9), 20, 80, 70, 75, 90, "21일");
        practiceLogs(user, OCT_19, OCT_20, OCT_21);
        em.flush();
        em.clear();

        HomeResponse response = home.home(user.getId(), OCT_21);

        assertThat(response.homeState()).isEqualTo(HomeState.DONE_TODAY);
        assertThat(response.currentStreak()).isEqualTo(3);
        assertThat(response.bestStreak()).isEqualTo(3);
        assertThat(response.practiceDates()).containsExactly(OCT_19, OCT_20, OCT_21);
        assertThat(response.todayInterviewCount()).isEqualTo(1);
        assertThat(response.todayPracticeMinutes()).isEqualTo(20);
        // 전달력 +30, 직무 +20, 논리 +5 순. 자소서는 그대로라 빠진다
        assertThat(response.todayImprovements())
                .containsExactly(
                        new Improvement(Criterion.DELIVERY, 30),
                        new Improvement(Criterion.JOB_FIT, 20),
                        new Improvement(Criterion.LOGIC, 5));
        // 그날 마지막 면접의 summary(AI 명세 4장)
        assertThat(response.nextActions()).containsExactly("21일 다음에 해볼 것");
        assertThat(response.nextActionsDate()).isEqualTo(OCT_21);
        assertThat(response.recentReviews()).hasSize(2);
        assertThat(response.recentReviews().get(0).practiceDate()).isEqualTo(OCT_21);
        assertThat(response.recentReviews().get(0).criterion()).isEqualTo(Criterion.DELIVERY);
        assertThat(response.recentReviews().get(0).delta()).isEqualTo(30);
        assertThat(response.recentReviews().get(1).practiceDate()).isEqualTo(OCT_19);
    }

    @Test
    void todayStillAnalyzingIsDoneTodayWithoutTodayImprovements() {
        User user = analyzingToday();

        HomeResponse response = home.home(user.getId(), OCT_21);

        assertThat(response.homeState()).isEqualTo(HomeState.DONE_TODAY);
        assertThat(response.todayInterviewCount()).isEqualTo(1);
        assertThat(response.todayPracticeMinutes()).isEqualTo(15);
        assertThat(response.todayImprovements()).isEmpty();
        // 오늘 결과가 아직 없어 가장 최근 리뷰(20일)의 다음에 해볼 것을 준다
        assertThat(response.nextActionsDate()).isEqualTo(OCT_20);
        assertThat(response.nextActions()).containsExactly("20일 다음에 해볼 것");
        assertThat(response.recentReviews()).hasSize(1);
        assertThat(response.recentReviews().get(0).practiceDate()).isEqualTo(OCT_20);
    }

    @Test
    void yesterdayPracticeIsNotDoneTodayAndOlderIsBroken() {
        User user = analyzingToday();

        HomeResponse nextDay = home.home(user.getId(), OCT_21.plusDays(1));
        assertThat(nextDay.homeState()).isEqualTo(HomeState.NOT_DONE_TODAY);
        assertThat(nextDay.currentStreak()).isEqualTo(2);
        assertThat(nextDay.todayInterviewCount()).isZero();
        assertThat(nextDay.todayPracticeMinutes()).isZero();
        assertThat(nextDay.todayImprovements()).isEmpty();

        HomeResponse later = home.home(user.getId(), OCT_21.plusDays(3));
        assertThat(later.homeState()).isEqualTo(HomeState.BROKEN);
        assertThat(later.currentStreak()).isZero();
        assertThat(later.bestStreak()).isEqualTo(2);
        assertThat(later.practiceDates()).containsExactly(OCT_20, OCT_21);
        assertThat(later.nextActionsDate()).isEqualTo(OCT_20);
    }

    @Test
    void nextActionsDateIsNullWhenLatestReviewHasNoActionText() {
        User user = user("no-actions");
        Application application = application(user, "○○전자");
        // summary가 비어 있는 결과
        InterviewSession session =
                new InterviewSession(user, application, Persona.DEVIL, InterviewMode.VIDEO);
        em.persist(session);
        session.start(at(OCT_21, 9));
        InterviewQuestion question = new InterviewQuestion(session, 1, "자기소개");
        em.persist(question);
        Answer answer = new Answer(question, InputType.VOICE, "답변");
        answer.evaluate(60, "좋아요", null);
        em.persist(answer);
        session.end(at(OCT_21, 9).plusMinutes(10), 1);
        session.complete("총평", " ");
        for (Criterion criterion : Criterion.values()) {
            em.persist(new SessionScore(session, criterion, 70, " "));
        }
        practiceLogs(user, OCT_21);
        em.flush();
        em.clear();

        HomeResponse response = home.home(user.getId(), OCT_21);

        assertThat(response.nextActions()).isEmpty();
        assertThat(response.nextActionsDate()).isNull();
        assertThat(response.recentReviews()).hasSize(1);
    }

    /** 20일 결과 완료, 21일은 분석 중인 면접만 있음 */
    private User analyzingToday() {
        User user = user("analyzing");
        Application application = application(user, "○○전자");
        completed(user, application, at(OCT_20, 9), 10, 60, 70, 70, 60, "20일");
        InterviewSession analyzing = session(user, application, at(OCT_21, 9));
        analyzing.end(at(OCT_21, 9).plusMinutes(15), 1);
        practiceLogs(user, OCT_20, OCT_21);
        User other = user("other");
        practiceLogs(other, OCT_21.plusDays(1), OCT_21.plusDays(3));
        em.flush();
        em.clear();
        return user;
    }

    private void completed(
            User owner,
            Application application,
            OffsetDateTime startedAt,
            int minutes,
            int jobFit,
            int coverLetter,
            int logic,
            int delivery,
            String comment) {
        InterviewSession session = session(owner, application, startedAt);
        session.end(startedAt.plusMinutes(minutes), 1);
        session.complete("총평", comment + " 다음에 해볼 것");
        em.persist(new SessionScore(session, Criterion.JOB_FIT, jobFit, comment));
        em.persist(
                new SessionScore(session, Criterion.COVER_LETTER, coverLetter, comment + " 자소서"));
        em.persist(new SessionScore(session, Criterion.LOGIC, logic, comment + " 논리"));
        em.persist(new SessionScore(session, Criterion.DELIVERY, delivery, comment + " 전달"));
    }

    /** 시작해서 답변 1개를 낸 면접 */
    private InterviewSession session(
            User owner, Application application, OffsetDateTime startedAt) {
        InterviewSession session =
                new InterviewSession(owner, application, Persona.DEVIL, InterviewMode.VIDEO);
        em.persist(session);
        session.start(startedAt);
        InterviewQuestion question = new InterviewQuestion(session, 1, "자기소개");
        em.persist(question);
        Answer answer = new Answer(question, InputType.VOICE, "답변");
        answer.evaluate(95, "좋아요", "높은 점수의 고칠 점");
        em.persist(answer);
        return session;
    }

    private void practiceLogs(User owner, LocalDate... dates) {
        for (LocalDate date : dates) {
            em.persist(new PracticeLog(owner, date));
        }
    }

    private User user(String name) {
        User created =
                new User("home-" + name + "-" + UUID.randomUUID() + "@example.com", "hash", name);
        em.persist(created);
        return created;
    }

    private Application application(User owner, String companyName) {
        Application application = new Application(owner, companyName, "백엔드 개발자", "자소서");
        em.persist(application);
        return application;
    }

    private static OffsetDateTime at(LocalDate date, int hour) {
        return date.atTime(hour, 0).atOffset(ZoneOffset.ofHours(9));
    }
}
