package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.QuestionPoolItem;
import com.ssafy.a301.interview.repository.QuestionPoolItemRepository;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import org.springframework.stereotype.Service;

/**
 * 질문 보관함에서 더 쓰지 않을 질문을 버린다(AI 명세 2장 폐기). 사용하지 않은 질문만 지운다. 사용한 질문은 다시 배정하지 않고 질문 생성에 이미 출제한
 * 질문(askedQuestions)으로 보내야 하므로 둔다.
 */
@Service
public class QuestionPoolDiscarder {
    private static final String SECTION = "section";
    private static final String RECENT = "recent";
    // 연결 항목이 카드의 같은 칸에 없으면 버리는 칸
    private static final Set<String> CARD_SECTIONS = Set.of("talent", "direction", "market");
    private static final int RECENT_DAYS = 30;

    private final QuestionPoolItemRepository poolItems;

    public QuestionPoolDiscarder(QuestionPoolItemRepository poolItems) {
        this.poolItems = poolItems;
    }

    /**
     * 5.1·5.3에서 보관함 질문 수를 세기 전에, 회사 정보가 바뀐 질문을 버린다. 최근 이슈에 연결한 질문은 기사 날짜(published)로부터 30일이 지났으면,
     * 인재상·사업 방향·시장에 연결한 질문은 면접을 만들 때 찾은 카드의 같은 칸에 같은 항목이 없으면 버린다. section을 뺀 칸이 모두 같으면 같은 항목이다. 회사
     * 정보와 연결하지 않은 질문은 버리지 않는다.
     */
    public void discardOutdated(InterviewSession session, LocalDate today) {
        Map<String, Object> card =
                session.getCompanyCard() == null ? null : session.getCompanyCard().getCard();
        discard(session, item -> isOutdated(item.getCompanyItem(), card, today));
    }

    /** 질문 생성 결과(plan.completed)를 보관함에 넣기 전에, 받은 결과와 프롬프트 버전이 다른 질문을 버린다 */
    public void discardOtherVersions(InterviewSession session, String promptVersion) {
        discard(session, item -> !item.getPromptVersion().equals(promptVersion));
    }

    private void discard(InterviewSession session, Predicate<QuestionPoolItem> stale) {
        poolItems.deleteAll(
                poolItems
                        .findByApplicationIdAndPersonaAndUsedAtIsNullOrderById(
                                session.getApplication().getId(), session.getPersona())
                        .stream()
                        .filter(stale)
                        .toList());
    }

    private static boolean isOutdated(
            Map<String, Object> companyItem, Map<String, Object> card, LocalDate today) {
        if (companyItem == null) {
            return false;
        }
        Object section = companyItem.get(SECTION);
        if (RECENT.equals(section)) {
            return isOld(companyItem.get("published"), today);
        }
        if (!CARD_SECTIONS.contains(section)) {
            return false;
        }
        Map<String, Object> entry = new HashMap<>(companyItem);
        entry.remove(SECTION);
        return card == null
                || !(card.get(section) instanceof List<?> entries)
                || !entries.contains(entry);
    }

    // 기사 날짜가 없거나 읽을 수 없으면 버리지 않는다
    private static boolean isOld(Object published, LocalDate today) {
        if (!(published instanceof String date)) {
            return false;
        }
        try {
            return LocalDate.parse(date).plusDays(RECENT_DAYS).isBefore(today);
        } catch (DateTimeParseException ex) {
            return false;
        }
    }
}
