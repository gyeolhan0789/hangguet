package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.company.domain.Company;
import com.ssafy.a301.company.domain.CompanyCard;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.QuestionPoolItem;
import com.ssafy.a301.interview.repository.QuestionPoolItemRepository;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

// 기준: AI 명세 2장 질문 보관함 폐기
@SpringBootTest
@Transactional
class QuestionPoolDiscarderTest {
    private static final LocalDate TODAY = LocalDate.parse("2026-11-13");
    private static final Map<String, Object> TALENT = talent();
    private static final Map<String, Object> MARKET =
            Map.of(
                    "summary",
                    "배송·결제 속도가 경쟁 요소",
                    "quote",
                    "…",
                    "source",
                    "최신 사업보고서",
                    "ncs_subcategories",
                    List.of("응용SW엔지니어링"));

    @Autowired private QuestionPoolDiscarder discarder;
    @Autowired private QuestionPoolItemRepository poolItems;
    @Autowired private EntityManager em;

    @Test
    void outdatedCompanyQuestionsAreDiscardedBeforeCounting() {
        Map<String, Object> card = new HashMap<>();
        card.put("corp_code", UUID.randomUUID().toString().substring(0, 8));
        card.put("talent", List.of(TALENT));
        card.put("market", List.of(MARKET));
        card.put("direction", List.of());
        InterviewSession session = newSession(card);
        Application application = session.getApplication();
        item(application, "같은 인재상", linked("talent", TALENT), "plan-v1");
        item(application, "바뀐 인재상", linked("talent", Map.of("title", "협업")), "plan-v1");
        item(application, "같은 시장", linked("market", MARKET), "plan-v1");
        item(application, "카드에 없는 사업 방향", linked("direction", MARKET), "plan-v1");
        // 10/14 기사는 11/13까지 둔다
        item(application, "30일 된 이슈", recent("2026-10-14"), "plan-v1");
        item(application, "31일 된 이슈", recent("2026-10-13"), "plan-v1");
        item(application, "날짜 없는 이슈", Map.of("section", "recent"), "plan-v1");
        item(application, "연결 안 함", null, "plan-v1");
        item(application, "사용한 바뀐 인재상", linked("talent", Map.of("title", "협업")), "plan-v1")
                .markUsed(OffsetDateTime.now());

        discard(session);

        assertThat(contents(application))
                .containsExactly("같은 인재상", "같은 시장", "30일 된 이슈", "날짜 없는 이슈", "연결 안 함", "사용한 바뀐 인재상");
    }

    @Test
    void withoutCardQuestionsLinkedToCardItemsAreDiscarded() {
        InterviewSession session = newSession(null);
        Application application = session.getApplication();
        item(application, "인재상", linked("talent", TALENT), "plan-v1");
        item(application, "새 이슈", recent("2026-11-01"), "plan-v1");
        item(application, "연결 안 함", null, "plan-v1");

        discard(session);

        assertThat(contents(application)).containsExactly("새 이슈", "연결 안 함");
    }

    @Test
    void unusedQuestionsOfOtherPromptVersionAreDiscarded() {
        InterviewSession session = newSession(null);
        Application application = session.getApplication();
        item(application, "이전 버전", null, "plan-v7");
        item(application, "사용한 이전 버전", null, "plan-v7").markUsed(OffsetDateTime.now());
        item(application, "같은 버전", null, "plan-v8");
        em.flush();

        discarder.discardOtherVersions(session, "plan-v8");
        em.flush();

        assertThat(contents(application)).containsExactly("사용한 이전 버전", "같은 버전");
    }

    // 저장한 카드·질문을 DB에서 다시 읽은 값으로 비교한다
    private void discard(InterviewSession session) {
        em.flush();
        em.clear();
        discarder.discardOutdated(em.find(InterviewSession.class, session.getId()), TODAY);
        em.flush();
    }

    private List<String> contents(Application application) {
        return poolItems
                .findByApplicationIdAndPersonaOrderById(application.getId(), Persona.DEVIL)
                .stream()
                .map(QuestionPoolItem::getContent)
                .toList();
    }

    private static Map<String, Object> linked(String section, Map<String, Object> entry) {
        Map<String, Object> item = new HashMap<>(entry);
        item.put("section", section);
        return item;
    }

    private static Map<String, Object> recent(String published) {
        return Map.of("section", "recent", "summary", "이슈", "published", published);
    }

    // 상위 범주가 없는 인재상 항목. 카드 항목의 null 칸도 그대로 비교한다
    private static Map<String, Object> talent() {
        Map<String, Object> talent = new HashMap<>();
        talent.put("title", "도전");
        talent.put("parent", null);
        talent.put("details", List.of("새로운 시도"));
        talent.put("source", "https://example.com/career");
        talent.put("criterion", "도전·실행");
        return talent;
    }

    private QuestionPoolItem item(
            Application application,
            String content,
            Map<String, Object> companyItem,
            String promptVersion) {
        QuestionPoolItem item =
                new QuestionPoolItem(
                        application,
                        Persona.DEVIL,
                        new PlanQuestion(1, content, "기준", "c1", companyItem, null),
                        promptVersion,
                        "gms-test");
        em.persist(item);
        return item;
    }

    private InterviewSession newSession(Map<String, Object> card) {
        User user = new User("discard-" + UUID.randomUUID() + "@example.com", "hash", "보관함");
        em.persist(user);
        Application application = new Application(user, "○○전자", "백엔드 개발자");
        em.persist(application);
        CompanyCard companyCard = null;
        if (card != null) {
            Company company = new Company((String) card.get("corp_code"), "카드회사", true);
            em.persist(company);
            companyCard =
                    new CompanyCard(company, card, "3".repeat(64), LocalDate.parse("2026-10-30"));
            em.persist(companyCard);
        }
        InterviewSession session =
                new InterviewSession(
                        user, application, companyCard, Persona.DEVIL, InterviewMode.CHAT);
        em.persist(session);
        em.flush();
        return session;
    }
}
