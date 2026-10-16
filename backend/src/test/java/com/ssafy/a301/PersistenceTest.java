package com.ssafy.a301;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.home.domain.PracticeLog;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.user.domain.TermsType;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.domain.UserAgreement;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

/**
 * 엔티티가 Flyway 스키마에 저장·조회되고 DB 제약이 동작하는지 확인한다. 로컬은 docker compose의 PostgreSQL이 필요하다.
 *
 * <p>ID를 IDENTITY로 만들어 persist 시점에 INSERT가 나가므로, 제약 위반은 persist에서 바로 확인한다.
 */
@SpringBootTest
@Transactional
class PersistenceTest {

    @Autowired private EntityManager em;

    @Test
    void savesAndReadsAllEntities() {
        User user = new User("db@ssafy.com", "hash", "면접왕");
        em.persist(user);
        em.persist(new UserAgreement(user, TermsType.RECORDING, "1.0"));
        Application application = new Application(user, "○○전자", "백엔드 개발자", "저는…");
        em.persist(application);

        InterviewSession session =
                new InterviewSession(user, application, Persona.DEVIL, InterviewMode.VIDEO);
        em.persist(session);
        session.start(OffsetDateTime.now());
        InterviewQuestion question = new InterviewQuestion(session, 1, "자기소개");
        em.persist(question);
        Answer answer = new Answer(question, InputType.VOICE, "안녕하세요");
        em.persist(answer);
        em.persist(Recording.answerAudio(session, answer, "sessions/1/answers/1.webm"));
        session.end(OffsetDateTime.now(), 1);
        answer.evaluate(85, "좋음", "아쉬움");
        em.persist(new SessionScore(session, Criterion.LOGIC, 80, "결론부터"));
        SpeechMetric metric =
                new SpeechMetric(
                        session,
                        new BigDecimal("2.10"),
                        3,
                        new BigDecimal("8.50"),
                        new BigDecimal("12.00"),
                        new BigDecimal("6.20"));
        em.persist(metric);
        metric.recordGazeRatio(new BigDecimal("71.50"));
        session.complete("총평");
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 15)));
        em.flush();
        em.clear();

        InterviewSession found = em.find(InterviewSession.class, session.getId());
        assertThat(found.getSummary()).isEqualTo("총평");
        assertThat(found.getApplication().getCompanyName()).isEqualTo("○○전자");
        assertThat(em.find(SpeechMetric.class, session.getId()).getGazeRatio())
                .isEqualByComparingTo("71.5");
        assertThat(em.find(Answer.class, answer.getId()).getScore()).isEqualTo(85);
    }

    @Test
    void withdrawnEmailCanBeReusedButActiveEmailIsUnique() {
        User left = new User("same@ssafy.com", "hash", "a");
        em.persist(left);
        left.withdraw(OffsetDateTime.now());
        em.flush();

        em.persist(new User("same@ssafy.com", "hash", "b"));
        em.flush();

        assertThatThrownBy(() -> em.persist(new User("same@ssafy.com", "hash", "c")))
                .hasMessageContaining("uk_users_email_active");
    }

    @Test
    void practiceLogIsOnePerUserPerDay() {
        User user = new User("log@ssafy.com", "hash", "a");
        em.persist(user);
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 15)));
        em.flush();

        assertThatThrownBy(() -> em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 15))))
                .hasMessageContaining("uk_practice_logs_user_date");
    }

    @Test
    void questionHasOneAnswer() {
        User user = new User("ans@ssafy.com", "hash", "a");
        em.persist(user);
        Application application = new Application(user, "회사", "직무", "자소서");
        em.persist(application);
        InterviewSession session =
                new InterviewSession(user, application, Persona.COFFEE_CHAT, InterviewMode.CHAT);
        em.persist(session);
        InterviewQuestion question = new InterviewQuestion(session, 1, "질문");
        em.persist(question);
        em.persist(new Answer(question, InputType.TEXT, "답1"));
        em.flush();

        assertThatThrownBy(() -> em.persist(new Answer(question, InputType.TEXT, "답2")))
                .hasMessageContaining("uk_answers_question");
    }
}
