package com.ssafy.a301.group.service;

import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.domain.TurnAnnounce;
import com.ssafy.a301.group.domain.TurnKind;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

/**
 * 다음 차례 정하기(docs/그룹면접-설계.md 6.3). 기본 질문 4개를 라운드로 묻는다: 1 공통(자기소개) → 2 개인 → 3 공통(인성) → 4 개인. 순서는
 * turn_order 고정이다. 그룹 행을 잠근 트랜잭션 안에서 부르고, 값만 계산하며 아무것도 바꾸지 않는다.
 *
 * <p>아직 다루지 않는 것(이탈 감지를 구현할 때 더함): 이탈한 참가자 건너뛰기, 남은 질문이 이탈한 사람 것뿐일 때 재접속 기다리기(WAITING).
 */
final class TurnPlanner {
    private static final Comparator<InterviewGroupParticipant> BY_ORDER =
            Comparator.comparing(InterviewGroupParticipant::getTurnOrder);

    private TurnPlanner() {}

    /**
     * @param active 나가지 않은 참가자
     * @param followupNeeded 방금 답한 사람에게 꼬리질문이 정해졌는지(followup.decided needed)
     * @return 다음 차례. 남은 질문이 없으면 비어 있다
     */
    static Optional<Turn> next(
            InterviewGroup group, List<InterviewGroupParticipant> active, boolean followupNeeded) {
        List<InterviewGroupParticipant> answering =
                active.stream()
                        .filter(p -> p.getTurnOrder() != null && p.isAnswering())
                        .sorted(BY_ORDER)
                        .toList();
        Optional<InterviewGroupParticipant> current =
                answering.stream()
                        .filter(p -> p.getSession().getId().equals(group.getTurnSessionId()))
                        .findFirst();
        int round = group.getRound();
        // 1. 방금 답한 사람의 꼬리질문
        if (followupNeeded && current.isPresent() && current.get().canReceiveFollowup()) {
            return Optional.of(
                    new Turn(current.get(), round, TurnKind.FOLLOWUP, TurnAnnounce.FULL));
        }
        // 2. 밀린 기본 질문(이전 라운드 것)부터
        Optional<InterviewGroupParticipant> overdue =
                answering.stream().filter(p -> p.getBaseDone() < round - 1).findFirst();
        if (overdue.isPresent()) {
            return Optional.of(base(overdue.get(), round, TurnAnnounce.FULL));
        }
        // 3. 이 라운드에서 순서상 다음 사람. 순서가 지났는데 받지 못한 사람은 그 뒤에. 지금 답변자가 면접을 끝냈어도 그 순서 다음부터 본다
        int currentOrder =
                active.stream()
                        .filter(p -> p.getSession().getId().equals(group.getTurnSessionId()))
                        .filter(p -> p.getTurnOrder() != null)
                        .map(InterviewGroupParticipant::getTurnOrder)
                        .findFirst()
                        .orElse(0);
        Optional<InterviewGroupParticipant> inRound =
                answering.stream()
                        .filter(p -> p.getBaseDone() < round)
                        .min(
                                Comparator.comparing(
                                                (InterviewGroupParticipant p) ->
                                                        p.getTurnOrder() <= currentOrder)
                                        .thenComparing(BY_ORDER));
        if (inRound.isPresent()) {
            boolean asked = active.stream().anyMatch(p -> p.getBaseDone() >= round);
            return Optional.of(
                    base(inRound.get(), round, asked ? TurnAnnounce.CALL : TurnAnnounce.FULL));
        }
        // 4. 이 라운드에 남은 사람이 없으면 라운드를 올린다
        for (int next = round + 1; next <= InterviewGroupParticipant.BASE_QUESTIONS; next++) {
            int nextRound = next;
            Optional<InterviewGroupParticipant> first =
                    answering.stream().filter(p -> p.getBaseDone() < nextRound).findFirst();
            if (first.isPresent()) {
                return Optional.of(base(first.get(), nextRound, TurnAnnounce.FULL));
            }
        }
        // 6. 남은 질문이 없다
        return Optional.empty();
    }

    // 기본 질문은 끝낸 수 다음 것이다. 1 · 3번은 공통, 2 · 4번은 개인 질문이다. 개인 질문은 그 사람 차례에 처음 말하므로 늘 질문 전체를 말한다
    private static Turn base(InterviewGroupParticipant p, int round, TurnAnnounce announce) {
        boolean common = p.getBaseDone() % 2 == 0;
        return new Turn(
                p,
                round,
                common ? TurnKind.COMMON : TurnKind.PERSONAL,
                common ? announce : TurnAnnounce.FULL);
    }

    /**
     * @param round 이 차례의 라운드. 밀린 질문이면 지금 라운드 그대로다
     */
    record Turn(
            InterviewGroupParticipant participant,
            int round,
            TurnKind kind,
            TurnAnnounce announce) {}
}
