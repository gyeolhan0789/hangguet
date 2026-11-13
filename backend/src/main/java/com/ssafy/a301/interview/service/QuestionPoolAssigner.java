package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanClaim;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.QuestionPoolItem;
import com.ssafy.a301.interview.repository.QuestionPoolItemRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.stream.IntStream;
import org.springframework.stereotype.Service;

/**
 * 질문 보관함에서 면접 질문 5개를 골라 면접 계획을 만든다(AI 명세 2장 출제 자리 배정). 배정할 때는 예약하지 않고 출제한 질문만 사용 처리하므로, 같은 보관함의 두
 * 면접이 같은 질문을 받을 수 있다.
 */
@Service
public class QuestionPoolAssigner {
    private final QuestionPoolItemRepository poolItems;

    public QuestionPoolAssigner(QuestionPoolItemRepository poolItems) {
        this.poolItems = poolItems;
    }

    /**
     * 개인 면접의 보관함(지원서 + 면접관)에 사용 처리하지 않은 질문이 5개 이상이면 배정한 면접 계획, 모자라면 비어 있다. 저장 순서(id)가 생성 순서라 id 순으로
     * 고른다. 1번은 가장 오래된 질문, 3번은 남은 질문 중 가장 오래된 회사 연결 질문(없으면 남은 질문 중 가장 오래된 질문), 2·4·5번은 남은 질문 중 오래된
     * 순서다. 계획의 버전은 배정한 질문 중 가장 최근에 만든 질문의 버전이다.
     */
    public Optional<InterviewPlan> assign(InterviewSession session, List<PlanClaim> claims) {
        List<QuestionPoolItem> unused =
                new ArrayList<>(
                        poolItems.findByApplicationIdAndPersonaAndUsedAtIsNullOrderById(
                                session.getApplication().getId(), session.getPersona()));
        if (unused.size() < InterviewPlan.QUESTION_COUNT) {
            return Optional.empty();
        }
        QuestionPoolItem first = unused.removeFirst();
        QuestionPoolItem third =
                unused.stream()
                        .filter(item -> item.getCompanyItem() != null)
                        .findFirst()
                        .orElse(unused.getFirst());
        unused.remove(third);
        List<QuestionPoolItem> picked =
                List.of(first, unused.get(0), third, unused.get(1), unused.get(2));
        List<PlanQuestion> questions =
                IntStream.range(0, picked.size())
                        .mapToObj(i -> picked.get(i).toPlanQuestion(i + 1))
                        .toList();
        QuestionPoolItem newest =
                picked.stream().max(Comparator.comparing(QuestionPoolItem::getId)).orElseThrow();
        return Optional.of(
                new InterviewPlan(
                        session.getId(),
                        claims,
                        questions,
                        newest.getPromptVersion(),
                        newest.getModelVersion()));
    }
}
