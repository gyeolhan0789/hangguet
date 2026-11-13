package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanClaim;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.QuestionPoolItem;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

// 기준: AI 명세 2장 질문 보관함(출제 자리 배정 · 사용 처리한 질문은 다시 배정하지 않는다)
@SpringBootTest
@Transactional
class QuestionPoolAssignerTest {
    private static final Map<String, Object> MARKET = Map.of("section", "market", "summary", "시장");
    private static final List<PlanClaim> CLAIMS =
            List.of(new PlanClaim("c1", "주장", "NUMBER", 1, List.of()));

    @Autowired private QuestionPoolAssigner assigner;
    @Autowired private EntityManager em;

    @Test
    void assignsOldestFirstAndOldestCompanyQuestionToThirdSeat() {
        InterviewSession session = newSession();
        Application application = session.getApplication();
        item(application, Persona.DEVIL, "사용", null, "plan-v1").markUsed(OffsetDateTime.now());
        item(application, Persona.COFFEE_CHAT, "다른 면접관", null, "plan-v1");
        QuestionPoolItem q2 = item(application, Persona.DEVIL, "질문2", null, "plan-v1");
        QuestionPoolItem q3 = item(application, Persona.DEVIL, "질문3", null, "plan-v1");
        QuestionPoolItem q4 = item(application, Persona.DEVIL, "회사4", MARKET, "plan-v1");
        QuestionPoolItem q5 = item(application, Persona.DEVIL, "질문5", null, "plan-v1");
        QuestionPoolItem q6 = item(application, Persona.DEVIL, "질문6", null, "plan-v2");
        item(application, Persona.DEVIL, "회사7", MARKET, "plan-v3");
        em.flush();

        InterviewPlan plan = assigner.assign(session, CLAIMS).orElseThrow();

        assertThat(plan.getQuestions())
                .extracting(PlanQuestion::seq, PlanQuestion::content, PlanQuestion::poolItemId)
                .containsExactly(
                        tuple(1, "질문2", q2.getId()),
                        tuple(2, "질문3", q3.getId()),
                        tuple(3, "회사4", q4.getId()),
                        tuple(4, "질문5", q5.getId()),
                        tuple(5, "질문6", q6.getId()));
        assertThat(plan.question(3).orElseThrow().companyItem()).isEqualTo(MARKET);
        assertThat(plan.getClaims()).isEqualTo(CLAIMS);
        // 배정한 질문 중 가장 최근에 만든 질문의 버전
        assertThat(plan.getPromptVersion()).isEqualTo("plan-v2");
    }

    @Test
    void withoutCompanyQuestionThirdSeatIsOldestAfterFirst() {
        InterviewSession session = newSession();
        for (int i = 1; i <= 5; i++) {
            item(session.getApplication(), Persona.DEVIL, "질문" + i, null, "plan-v1");
        }
        em.flush();

        assertThat(assigner.assign(session, CLAIMS).orElseThrow().getQuestions())
                .extracting(PlanQuestion::content)
                .containsExactly("질문1", "질문3", "질문2", "질문4", "질문5");
    }

    @Test
    void fewerThanFiveUnusedQuestionsAreNotAssigned() {
        InterviewSession session = newSession();
        item(session.getApplication(), Persona.DEVIL, "사용", null, "plan-v1")
                .markUsed(OffsetDateTime.now());
        for (int i = 1; i <= 4; i++) {
            item(session.getApplication(), Persona.DEVIL, "질문" + i, null, "plan-v1");
        }
        em.flush();

        assertThat(assigner.assign(session, CLAIMS)).isEmpty();
    }

    private QuestionPoolItem item(
            Application application,
            Persona persona,
            String content,
            Map<String, Object> companyItem,
            String promptVersion) {
        QuestionPoolItem item =
                new QuestionPoolItem(
                        application,
                        persona,
                        new PlanQuestion(1, content, "기준", "c1", companyItem, null),
                        promptVersion,
                        "gms-test");
        em.persist(item);
        return item;
    }

    private InterviewSession newSession() {
        User user = new User("pool-" + UUID.randomUUID() + "@example.com", "hash", "보관함");
        em.persist(user);
        Application application = new Application(user, "○○전자", "백엔드 개발자");
        em.persist(application);
        InterviewSession session =
                new InterviewSession(user, application, Persona.DEVIL, InterviewMode.CHAT);
        em.persist(session);
        em.flush();
        return session;
    }
}
