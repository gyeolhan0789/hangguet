package com.ssafy.a301.group.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.domain.TurnAnnounce;
import com.ssafy.a301.group.domain.TurnKind;
import com.ssafy.a301.group.service.TurnPlanner.Turn;
import com.ssafy.a301.interview.domain.InterviewSession;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** 다음 차례 정하기(docs/그룹면접-설계.md 6.3)의 규칙을 참가자 상태만으로 확인한다. 전체 흐름은 InterviewGroupIntegrationTest가 본다. */
class TurnPlannerTest {

    @Test
    void followupGoesToSameParticipantUntilTwoAreUsed() {
        InterviewGroupParticipant a = participant(1L, 1, 1, 1);
        InterviewGroupParticipant b = participant(2L, 2, 0, 0);

        Turn followup = next(group(1, 1L), List.of(a, b), true).orElseThrow();
        assertThat(followup.participant()).isSameAs(a);
        assertThat(followup.kind()).isEqualTo(TurnKind.FOLLOWUP);

        // 꼬리질문을 둘 다 받았으면 필요하다고 해도 다음 사람이다
        InterviewGroupParticipant used = participant(1L, 1, 1, 2);
        Turn next = next(group(1, 1L), List.of(used, b), true).orElseThrow();
        assertThat(next.participant()).isSameAs(b);
        assertThat(next.kind()).isEqualTo(TurnKind.COMMON);
        assertThat(next.announce()).isEqualTo(TurnAnnounce.CALL);
    }

    @Test
    void lastInRoundMovesToNextRoundWithFirstParticipant() {
        InterviewGroupParticipant a = participant(1L, 1, 1, 0);
        InterviewGroupParticipant b = participant(2L, 2, 1, 0);

        Turn next = next(group(1, 2L), List.of(a, b), false).orElseThrow();
        assertThat(next.participant()).isSameAs(a);
        assertThat(next.round()).isEqualTo(2);
        assertThat(next.kind()).isEqualTo(TurnKind.PERSONAL);
        assertThat(next.announce()).isEqualTo(TurnAnnounce.FULL);
        // 라운드 3의 첫 사람은 공통 질문 전체를 말한다
        InterviewGroupParticipant a2 = participant(1L, 1, 2, 0);
        InterviewGroupParticipant b2 = participant(2L, 2, 2, 0);
        Turn third = next(group(2, 2L), List.of(a2, b2), false).orElseThrow();
        assertThat(third.round()).isEqualTo(3);
        assertThat(third.kind()).isEqualTo(TurnKind.COMMON);
        assertThat(third.announce()).isEqualTo(TurnAnnounce.FULL);
    }

    @Test
    void endedAndDoneParticipantsAreSkipped() {
        InterviewGroupParticipant a = participant(1L, 1, 1, 0);
        InterviewGroupParticipant ended = participant(2L, 2, 0, 0);
        when(ended.isAnswering()).thenReturn(false);
        InterviewGroupParticipant c = participant(3L, 3, 0, 0);

        Turn next = next(group(1, 1L), List.of(a, ended, c), false).orElseThrow();
        assertThat(next.participant()).isSameAs(c);
        // 지금 답변자가 면접을 끝냈어도 그 순서 다음부터 본다
        InterviewGroupParticipant endedCurrent = participant(1L, 1, 0, 0);
        when(endedCurrent.isAnswering()).thenReturn(false);
        InterviewGroupParticipant b = participant(2L, 2, 0, 0);
        Turn afterEnded = next(group(1, 1L), List.of(endedCurrent, b), false).orElseThrow();
        assertThat(afterEnded.participant()).isSameAs(b);
        assertThat(afterEnded.announce()).isEqualTo(TurnAnnounce.FULL);
    }

    // 6.9: 이탈한 사람은 건너뛰고 나간 답변자에게 꼬리질문을 주지 않는다. 돌아온 사람은 이 라운드에서 순서가 지난 자기 질문부터 받는다
    @Test
    void absentParticipantsAreSkippedAndReturnedOnesGoFirst() {
        InterviewGroupParticipant a = participant(1L, 1, 1, 0);
        InterviewGroupParticipant absent = participant(2L, 2, 0, 0);
        when(absent.isAbsent()).thenReturn(true);
        InterviewGroupParticipant c = participant(3L, 3, 0, 0);
        assertThat(next(group(1, 1L), List.of(a, absent, c), false).orElseThrow().participant())
                .isSameAs(c);

        InterviewGroupParticipant leftCurrent = participant(1L, 1, 1, 0);
        when(leftCurrent.isAbsent()).thenReturn(true);
        InterviewGroupParticipant b = participant(2L, 2, 0, 0);
        Turn afterLeft = next(group(1, 1L), List.of(leftCurrent, b), true).orElseThrow();
        assertThat(afterLeft.participant()).isSameAs(b);
        assertThat(afterLeft.kind()).isEqualTo(TurnKind.COMMON);

        // 라운드 2에서 1번이 나가 건너뛰었고 2번이 답한 뒤 1번이 돌아왔다: 3번보다 1번이 먼저다
        InterviewGroupParticipant returned = participant(1L, 1, 1, 0);
        InterviewGroupParticipant current = participant(2L, 2, 2, 0);
        InterviewGroupParticipant last = participant(3L, 3, 1, 0);
        Turn overdue = next(group(2, 2L), List.of(returned, current, last), false).orElseThrow();
        assertThat(overdue.participant()).isSameAs(returned);
        assertThat(overdue.kind()).isEqualTo(TurnKind.PERSONAL);
    }

    @Test
    void noTurnWhenEveryoneFinishedBaseQuestions() {
        InterviewGroupParticipant a = participant(1L, 1, 4, 1);
        InterviewGroupParticipant b = participant(2L, 2, 4, 0);

        assertThat(next(group(4, 2L), List.of(a, b), false)).isEmpty();
    }

    private static Optional<Turn> next(
            InterviewGroup group, List<InterviewGroupParticipant> active, boolean followup) {
        return TurnPlanner.next(group, active, followup);
    }

    private static InterviewGroup group(int round, long turnSessionId) {
        InterviewGroup group = mock(InterviewGroup.class);
        when(group.getRound()).thenReturn(round);
        when(group.getTurnSessionId()).thenReturn(turnSessionId);
        return group;
    }

    private static InterviewGroupParticipant participant(
            long sessionId, int turnOrder, int baseDone, int followupsUsed) {
        InterviewSession session = mock(InterviewSession.class);
        when(session.getId()).thenReturn(sessionId);
        InterviewGroupParticipant p = mock(InterviewGroupParticipant.class);
        when(p.getSession()).thenReturn(session);
        when(p.getTurnOrder()).thenReturn(turnOrder);
        when(p.getBaseDone()).thenReturn(baseDone);
        when(p.getFollowupsUsed()).thenReturn(followupsUsed);
        when(p.isAnswering()).thenReturn(true);
        when(p.canReceiveFollowup())
                .thenReturn(followupsUsed < InterviewGroupParticipant.MAX_FOLLOWUPS);
        return p;
    }
}
