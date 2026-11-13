package com.ssafy.a301;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.domain.ApplicationClaim;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.AnswerToken;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanClaim;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.QuestionPoolItem;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.practice.domain.PracticeLog;
import com.ssafy.a301.user.domain.SocialProvider;
import com.ssafy.a301.user.domain.TermsType;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.domain.UserAgreement;
import com.ssafy.a301.user.domain.UserSocialAccount;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.repository.UserSocialAccountRepository;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
    @Autowired private InterviewPlanRepository plans;
    @Autowired private UserRepository users;
    @Autowired private UserSocialAccountRepository socialAccounts;

    @Test
    void savesAndReadsAllEntities() {
        User user = new User("db@ssafy.com", "hash", "면접왕");
        em.persist(user);
        em.persist(new UserAgreement(user, TermsType.RECORDING, "1.0"));
        Application application = new Application(user, "○○전자", "백엔드 개발자");
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
        session.complete("총평", "다음에 해볼 것");
        em.persist(new PracticeLog(user, LocalDate.of(2026, 10, 15)));
        em.flush();
        em.clear();

        InterviewSession found = em.find(InterviewSession.class, session.getId());
        assertThat(found.getHeadline()).isEqualTo("총평");
        assertThat(found.getSummary()).isEqualTo("다음에 해볼 것");
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
    void socialAccountIsUniqueOnlyWhileNotWithdrawn() {
        User left = User.social("social@ssafy.com", "a");
        em.persist(left);
        em.persist(new UserSocialAccount(left, SocialProvider.KAKAO, "12345"));
        left.withdraw(OffsetDateTime.now());
        assertThat(socialAccounts.withdrawAll(left.getId(), OffsetDateTime.now())).isEqualTo(1);
        em.flush();
        em.clear();
        assertThat(socialAccounts.findActive(SocialProvider.KAKAO, "12345")).isEmpty();

        User again = User.social("social@ssafy.com", "b");
        em.persist(again);
        em.persist(new UserSocialAccount(again, SocialProvider.KAKAO, "12345"));
        em.flush();
        assertThat(socialAccounts.findActive(SocialProvider.KAKAO, "12345"))
                .get()
                .extracting(account -> account.getUser().getId())
                .isEqualTo(again.getId());
        assertThat(socialAccounts.findActiveProvider(again.getId())).contains(SocialProvider.KAKAO);
        assertThat(users.findById(again.getId()).orElseThrow().hasPassword()).isFalse();

        User other = User.social("other@ssafy.com", "c");
        em.persist(other);
        assertThatThrownBy(
                        () ->
                                em.persist(
                                        new UserSocialAccount(
                                                other, SocialProvider.KAKAO, "12345")))
                .hasMessageContaining("uk_user_social_accounts_active");
    }

    @Test
    void mixedCaseEmailSavedBeforeNormalizationIsFoundByLowercase() {
        // 소문자로 저장하기 전에 들어온 데이터. 가입 전 확인(existsActiveByEmail)이 대소문자를 무시하고 찾아 중복 가입을 막는다
        em.createNativeQuery(
                        "INSERT INTO users (email, password_hash, nickname, created_at, updated_at)"
                                + " VALUES ('Legacy@SSAFY.com', 'hash', 'a', now(), now())")
                .executeUpdate();

        assertThat(users.findActiveByEmail("legacy@ssafy.com")).hasSize(1);
        assertThat(users.existsActiveByEmail("legacy@ssafy.com")).isTrue();
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
        Application application = new Application(user, "회사", "직무");
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

    // 기준: API 명세 4.1(문항 1~5개). 문항 순서는 1~5만, 한 지원서 안에서 겹치지 않는다
    // 제약 위반 뒤에는 트랜잭션이 끝나므로 0과 6을 각각의 테스트로 확인한다
    @ParameterizedTest
    @ValueSource(ints = {0, 6})
    void coverLetterItemOrderIsOneToFive(int itemOrder) {
        Application application = newApplication("item-order-" + itemOrder + "@ssafy.com");

        assertThatThrownBy(() -> insertCoverLetterItem(application.getId(), itemOrder))
                .hasMessageContaining("ck_cover_letter_items_item_order");
    }

    @Test
    void coverLetterItemOrderIsUniquePerApplication() {
        Application application = newApplication("item-unique@ssafy.com");
        insertCoverLetterItem(application.getId(), 1);

        assertThatThrownBy(() -> insertCoverLetterItem(application.getId(), 1))
                .hasMessageContaining("uk_cover_letter_items_application_order");
    }

    @Test
    void planIsSavedOncePerSessionAndReadBySeq() {
        InterviewSession session = newSession("plan@ssafy.com", InterviewMode.VIDEO);
        plans.save(
                new InterviewPlan(
                        session.getId(),
                        List.of(new PlanClaim("c1", "응답 시간을 40% 줄였다", "NUMBER", 4)),
                        List.of(
                                new PlanQuestion(1, "질문1", "기준1", "c1"),
                                new PlanQuestion(2, "질문2", "기준2", "c1")),
                        "plan-v1",
                        "gms-test"));
        em.flush();
        em.clear();

        InterviewPlan plan = em.find(InterviewPlan.class, session.getId());
        assertThat(plan.getClaims())
                .containsExactly(new PlanClaim("c1", "응답 시간을 40% 줄였다", "NUMBER", 4));
        assertThat(plan.question(2))
                .hasValueSatisfying(
                        q -> {
                            assertThat(q.content()).isEqualTo("질문2");
                            assertThat(q.criteria()).isEqualTo("기준2");
                        });
        assertThat(plan.question(3)).isEmpty();
        assertThat(plan.getPromptVersion()).isEqualTo("plan-v1");
        em.clear();
        assertThatThrownBy(
                        () -> {
                            plans.save(
                                    new InterviewPlan(
                                            session.getId(), List.of(), List.of(), "v2", "m2"));
                            em.flush();
                        })
                .hasMessageContaining("interview_plans_pkey");
    }

    // 기준: BE 설계 3장 ApplicationClaim(지원서마다 주장 id가 겹치지 않는다, 인재상 기준은 목록 그대로)
    @Test
    void applicationClaimsKeepTalentCriteriaAndAreUniquePerApplication() {
        Application application =
                newSession("claim@ssafy.com", InterviewMode.CHAT).getApplication();
        em.persist(
                new ApplicationClaim(
                        application,
                        new PlanClaim("c1", "응답 시간을 40% 줄였다", "NUMBER", 4, List.of("실행·성과")),
                        "extract-claims-v1",
                        "gms-test"));
        em.flush();
        em.clear();

        ApplicationClaim claim =
                em.createQuery(
                                "select c from ApplicationClaim c where c.application.id = :id",
                                ApplicationClaim.class)
                        .setParameter("id", application.getId())
                        .getSingleResult();
        assertThat(claim.toPlanClaim())
                .isEqualTo(new PlanClaim("c1", "응답 시간을 40% 줄였다", "NUMBER", 4, List.of("실행·성과")));
        assertThat(claim.getCreatedAt()).isNotNull();
        assertThatThrownBy(
                        () -> {
                            em.persist(
                                    new ApplicationClaim(
                                            em.getReference(Application.class, application.getId()),
                                            new PlanClaim("c1", "다른 주장", "EXPERIENCE", 5),
                                            "extract-claims-v1",
                                            "gms-test"));
                            em.flush();
                        })
                .hasMessageContaining("uk_application_claims_application_claim");
    }

    // 기준: BE 설계 3장 QuestionPoolItem(연결 회사 항목은 받은 객체 그대로 둔다)
    @Test
    void questionPoolItemKeepsCompanyItemAsReceived() {
        Application application = newSession("pool@ssafy.com", InterviewMode.CHAT).getApplication();
        Map<String, Object> companyItem =
                Map.of(
                        "section",
                        "market",
                        "summary",
                        "배송·결제 속도가 경쟁 요소",
                        "ncs_subcategories",
                        List.of("응용SW엔지니어링"));
        QuestionPoolItem item =
                new QuestionPoolItem(
                        application,
                        Persona.COFFEE_CHAT,
                        new PlanQuestion(3, "질문3", "기준3", "c1", companyItem),
                        "plan-v8",
                        "gms-test");
        em.persist(item);
        em.flush();
        em.clear();

        QuestionPoolItem found = em.find(QuestionPoolItem.class, item.getId());
        assertThat(found.getPersona()).isEqualTo(Persona.COFFEE_CHAT);
        assertThat(found.getContent()).isEqualTo("질문3");
        assertThat(found.getCompanyItem()).isEqualTo(companyItem);
        assertThat(found.getPromptVersion()).isEqualTo("plan-v8");
    }

    // 기준: AI 명세 1.3(주장 추출은 지원서 단위 작업). Outbox 행은 면접과 지원서 중 하나만 가리킨다
    @Test
    void aiJobPointsToEitherSessionOrApplication() {
        Application application = newSession("job@ssafy.com", InterviewMode.CHAT).getApplication();
        AiJob job = AiJob.extractClaims(application.getId());
        em.persist(job);
        em.flush();
        em.clear();

        AiJob found = em.find(AiJob.class, job.getId());
        assertThat(found.getApplicationId()).isEqualTo(application.getId());
        assertThat(found.getSessionId()).isNull();
        assertThatThrownBy(
                        () ->
                                em.createNativeQuery(
                                                "INSERT INTO ai_job_outbox (id, job_type,"
                                                        + " created_at) VALUES"
                                                        + " (gen_random_uuid(), 'PLAN', now())")
                                        .executeUpdate())
                .hasMessageContaining("ck_ai_job_outbox_target");
    }

    @Test
    void answerTokensAndFirstEvaluationAreStored() {
        InterviewSession session = newSession("token@ssafy.com", InterviewMode.VIDEO);
        InterviewQuestion question =
                new InterviewQuestion(
                        session, 1, "질문", OffsetDateTime.parse("2026-10-15T12:01:00+09:00"));
        em.persist(question);
        List<AnswerToken> tokens =
                List.of(new AnswerToken("조회", 0, 280), new AnswerToken(" ", 280, 320));
        Answer answer = new Answer(question, InputType.VOICE, "조회 ", tokens);
        em.persist(answer);
        assertThat(answer.recordEvaluation(Map.of("scoreMethod", "FIXED"))).isTrue();
        // 같은 채점 결과가 다시 와도 처음 것을 둔다
        assertThat(answer.recordEvaluation(Map.of("scoreMethod", "PROBABILITY"))).isFalse();
        em.flush();
        em.clear();

        Answer found = em.find(Answer.class, answer.getId());
        assertThat(found.getTokens()).containsExactlyElementsOf(tokens);
        assertThat(found.getEvaluation()).containsEntry("scoreMethod", "FIXED");
        assertThat(found.getQuestion().getCreatedAt())
                .isEqualTo(OffsetDateTime.parse("2026-10-15T12:01:00+09:00"));
    }

    @Test
    void textAnswerHasNoTokens() {
        InterviewSession session = newSession("text@ssafy.com", InterviewMode.CHAT);
        InterviewQuestion question = new InterviewQuestion(session, 1, "질문");
        em.persist(question);
        Answer answer = new Answer(question, InputType.TEXT, "답");
        em.persist(answer);
        em.flush();
        em.clear();

        assertThat(em.find(Answer.class, answer.getId()).getTokens()).isNull();
    }

    private Application newApplication(String email) {
        User user = new User(email, "hash", "a");
        em.persist(user);
        Application application = new Application(user, "회사", "직무");
        em.persist(application);
        em.flush();
        return application;
    }

    private void insertCoverLetterItem(long applicationId, int itemOrder) {
        em.createNativeQuery(
                        "INSERT INTO cover_letter_items (application_id, item_order, question,"
                                + " answer) VALUES (?1, ?2, '문항', '답변')")
                .setParameter(1, applicationId)
                .setParameter(2, itemOrder)
                .executeUpdate();
    }

    private InterviewSession newSession(String email, InterviewMode mode) {
        User user = new User(email, "hash", "a");
        em.persist(user);
        Application application = new Application(user, "회사", "직무");
        em.persist(application);
        InterviewSession session = new InterviewSession(user, application, Persona.DEVIL, mode);
        em.persist(session);
        em.flush();
        return session;
    }
}
