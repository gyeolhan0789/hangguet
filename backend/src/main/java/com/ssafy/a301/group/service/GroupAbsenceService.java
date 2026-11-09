package com.ssafy.a301.group.service;

import com.ssafy.a301.group.domain.GroupPhase;
import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.domain.TurnKind;
import com.ssafy.a301.group.repository.GroupDraftStore;
import com.ssafy.a301.group.repository.InterviewGroupParticipantRepository;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import com.ssafy.a301.group.repository.WebhookEventStore;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.room.GroupRoomEvent;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.room.InterviewRoom.GroupPresence;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 그룹 면접 진행 중 이탈 · 재입장(docs/그룹면접-설계.md 6.9). LiveKit 웹훅으로 바로 알고, 웹훅이 빠질 수 있어 주기적으로 면접방 참가자를 조회해 맞춘다.
 * 모두 그룹 행 → 면접 행(id 순서)을 잠그고 DB 값으로 다시 확인하므로 같은 사건이 두 번 와도 결과가 같다.
 *
 * <ul>
 *   <li>지원자 퇴장: absent_since를 남기고 차례에서 건너뛴다. 지금 답변자면 진행 중이던 답변은 버리고 다음 차례로 간다. 기본 질문은 닫지 않고 두어 돌아오면
 *       같은 seq로 다시 묻고, 꼬리질문은 닫는다
 *   <li>지원자 재입장: absent_since를 지운다. 이탈한 사람을 기다리던 중(WAITING)이면 다음 차례를 정한다
 *   <li>면접관 퇴장: AI 장애(6.11)
 * </ul>
 *
 * <p>이탈 2분 초과 종료는 마감 처리기가 한다(GroupDeadlineService).
 */
@Service
public class GroupAbsenceService {
    private static final Logger LOG = LoggerFactory.getLogger(GroupAbsenceService.class);

    private final InterviewGroupRepository groups;
    private final InterviewGroupParticipantRepository participants;
    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final GroupDraftStore drafts;
    private final GroupTurnFlow flow;
    private final GroupRoomUpdates roomUpdates;
    private final GroupEndService groupEnds;
    private final InterviewRoom rooms;
    private final WebhookEventStore webhookEvents;
    private final TransactionTemplate transactions;
    private final Duration joinGrace;

    public GroupAbsenceService(
            InterviewGroupRepository groups,
            InterviewGroupParticipantRepository participants,
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            GroupDraftStore drafts,
            GroupTurnFlow flow,
            GroupRoomUpdates roomUpdates,
            GroupEndService groupEnds,
            InterviewRoom rooms,
            WebhookEventStore webhookEvents,
            TransactionTemplate transactions,
            @Value("${group.join-grace:30s}") Duration joinGrace) {
        this.groups = groups;
        this.participants = participants;
        this.sessions = sessions;
        this.questions = questions;
        this.drafts = drafts;
        this.flow = flow;
        this.roomUpdates = roomUpdates;
        this.groupEnds = groupEnds;
        this.rooms = rooms;
        this.webhookEvents = webhookEvents;
        this.transactions = transactions;
        this.joinGrace = joinGrace;
    }

    /** 웹훅 이벤트 하나. 같은 이벤트는 한 번만 처리하고, 처리하지 못하면 다시 받을 수 있게 둔다 */
    public void handle(GroupRoomEvent event) {
        if (!webhookEvents.markNew(event.id())) {
            return;
        }
        try {
            OffsetDateTime now = OffsetDateTime.now();
            boolean left = event.type() == GroupRoomEvent.Type.LEFT;
            if (event.isInterviewer()) {
                if (left) {
                    interviewerLeft(event.groupId(), now);
                }
            } else if (left) {
                left(event.groupId(), event.sessionId(), now);
            } else {
                returned(event.groupId(), event.sessionId(), now);
            }
        } catch (RuntimeException ex) {
            webhookEvents.forget(event.id());
            throw ex;
        }
    }

    /**
     * 지원자가 면접방에서 나갔다.
     *
     * @return 이탈로 남겼으면 true. 이미 이탈했거나 면접이 끝났으면 false
     */
    public boolean left(long groupId, long sessionId, OffsetDateTime now) {
        return Boolean.TRUE.equals(
                transactions.execute(
                        status -> {
                            Locked locked = lock(groupId);
                            InterviewGroupParticipant participant =
                                    locked == null ? null : locked.find(sessionId);
                            if (participant == null || !participant.markAbsent(now)) {
                                return false;
                            }
                            LOG.info("그룹 면접 참가자가 나갔다: group={} session={}", groupId, sessionId);
                            InterviewGroup group = locked.group();
                            if (Long.valueOf(sessionId).equals(group.getTurnSessionId())) {
                                leaveTurn(group, locked.active(), sessionId, now);
                            } else {
                                group.touch(now);
                            }
                            roomUpdates.publishAfterCommit(group, locked.active(), now);
                            return true;
                        }));
    }

    /**
     * 이탈한 지원자가 다시 들어왔다. 지금 차례가 끝나면 밀린 질문부터 받는다(6.3 규칙 2).
     *
     * @return 이탈을 지웠으면 true
     */
    public boolean returned(long groupId, long sessionId, OffsetDateTime now) {
        return Boolean.TRUE.equals(
                transactions.execute(
                        status -> {
                            Locked locked = lock(groupId);
                            InterviewGroupParticipant participant =
                                    locked == null ? null : locked.find(sessionId);
                            if (participant == null || !participant.markPresent()) {
                                return false;
                            }
                            LOG.info("그룹 면접 참가자가 다시 들어왔다: group={} session={}", groupId, sessionId);
                            InterviewGroup group = locked.group();
                            // 이탈한 사람을 기다리던 중이면 지금 차례가 없다
                            if (group.getTurnSessionId() == null) {
                                flow.advance(group, locked.active(), false, now);
                            } else {
                                group.touch(now);
                            }
                            roomUpdates.publishAfterCommit(group, locked.active(), now);
                            return true;
                        }));
    }

    /**
     * 면접관(에이전트)이 면접방에서 나갔다. AI 장애로 본다(6.11).
     *
     * @return 처리했으면 true. 이미 끝났거나 시작 실패한 그룹이면 false
     */
    public boolean interviewerLeft(long groupId, OffsetDateTime now) {
        return Boolean.TRUE.equals(
                transactions.execute(
                        status -> {
                            InterviewGroup group = groups.findByIdForUpdate(groupId).orElse(null);
                            if (group == null || group.getStatus() != GroupStatus.IN_PROGRESS) {
                                return false;
                            }
                            LOG.warn("AI 면접관이 그룹 면접방에서 나갔다: group={}", groupId);
                            groupEnds.stopForAiFailure(
                                    group,
                                    sessions.findAllForUpdate(
                                            participants.findActiveSessionIds(groupId)),
                                    now);
                            return true;
                        }));
    }

    /**
     * 진행 중 그룹의 이탈 상태를 면접방 참가자 목록(ListParticipants)에 맞춘다(6.5 · 6.9). 웹훅이 빠지거나 순서가 바뀌어도 이것으로 고친다. 막
     * 시작한 그룹은 아직 들어오는 중이라 joinGrace가 지난 뒤부터 본다. 한 그룹이 실패해도 다른 그룹은 본다.
     */
    public void reconcile(OffsetDateTime now) {
        for (long groupId : groups.findInProgressIdsStartedBefore(now.minus(joinGrace))) {
            try {
                reconcile(groupId, now);
            } catch (RuntimeException ex) {
                LOG.warn("그룹 면접방 참가자를 맞추지 못했다: group={}", groupId, ex);
            }
        }
    }

    private void reconcile(long groupId, OffsetDateTime now) {
        Optional<GroupPresence> found = rooms.groupPresence(groupId);
        if (found.isEmpty()) {
            return;
        }
        GroupPresence presence = found.get();
        if (!presence.interviewer()) {
            interviewerLeft(groupId, now);
            return;
        }
        for (InterviewGroupParticipant p : participants.findActiveByGroupId(groupId)) {
            if (p.getSession().getStatus() != SessionStatus.IN_PROGRESS) {
                continue;
            }
            long sessionId = p.getSession().getId();
            boolean here = presence.candidates().contains(sessionId);
            if (!here && !p.isAbsent()) {
                left(groupId, sessionId, now);
            } else if (here && p.isAbsent()) {
                returned(groupId, sessionId, now);
            }
        }
    }

    // 지금 답변자가 나갔다. 진행 중이던 답변은 버린다(에이전트도 버린다). 답변 중이던 기본 질문은 닫지 않고 두어 돌아오면 같은 seq로 다시 묻고,
    // 꼬리질문은 닫는다(돌아온 뒤 다시 묻지 않는다). 질문을 시작하기 전이거나 꼬리질문 판단 중이면 그대로 다음 차례로 간다
    private void leaveTurn(
            InterviewGroup group,
            List<InterviewGroupParticipant> active,
            long sessionId,
            OffsetDateTime now) {
        if (!group.isPhase(GroupPhase.SPEAKING) && !group.isPhase(GroupPhase.ANSWERING)) {
            flow.advance(group, active, false, now);
            return;
        }
        InterviewQuestion question =
                questions.findBySessionIdAndSeq(sessionId, group.getTurnSeq()).orElseThrow();
        if (group.getTurnKind() == TurnKind.FOLLOWUP) {
            question.close(now);
            flow.finishQuestion(group, active, false, now);
        } else {
            flow.advance(group, active, false, now);
        }
        long questionId = question.getId();
        afterCommit(() -> drafts.delete(sessionId, questionId));
    }

    // 잠금 순서: 그룹 → 면접(id 순서, docs/그룹면접-설계.md 9장). 진행 중 그룹이 아니면 null
    private Locked lock(long groupId) {
        InterviewGroup group = groups.findByIdForUpdate(groupId).orElse(null);
        if (group == null || group.getStatus() != GroupStatus.IN_PROGRESS) {
            return null;
        }
        sessions.findAllForUpdate(participants.findActiveSessionIds(groupId));
        return new Locked(group, participants.findActiveByGroupId(groupId));
    }

    private static void afterCommit(Runnable action) {
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        action.run();
                    }
                });
    }

    private record Locked(InterviewGroup group, List<InterviewGroupParticipant> active) {
        // 진행 중 면접의 참가자. 대기실에서 나갔거나 면접이 끝났으면 null
        InterviewGroupParticipant find(long sessionId) {
            return active.stream()
                    .filter(p -> p.getSession().getId() == sessionId)
                    .filter(p -> p.getSession().getStatus() == SessionStatus.IN_PROGRESS)
                    .findFirst()
                    .orElse(null);
        }
    }
}
