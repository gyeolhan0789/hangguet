package com.ssafy.a301.group.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.repository.GroupDraftStore;
import com.ssafy.a301.group.repository.InterviewGroupParticipantRepository;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import com.ssafy.a301.interview.domain.EndReason;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.service.SessionEnder;
import java.math.BigDecimal;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 그룹 세션 종료 · 그룹 종료(docs/그룹면접-설계.md 6.10). 그룹 행 → 참가자 면접 행(id 순서)을 잠그고, 세션 하나를 개인 면접 5.8과 같이 끝낸다. 남은
 * 세션이 있으면 끝낸 사람이 지금 답변자일 때 다음 차례로 넘기고, 끝낸 사람을 면접방에서 내보내고 면접방 정보를 바꾼다. 마지막 세션이면 그룹을 ENDED로 바꾸고 면접방을
 * 지운다. 면접방은 커밋 뒤에 정리한다.
 *
 * <p>아직 하지 않는 것(이탈 감지 · 녹화 합치기를 구현할 때 더함): 이탈 2분 초과로 끝내기, 녹화 합치기 작업(본인 답변 구간 segments가 필요하다, 6.12).
 */
@Service
public class GroupEndService {
    private static final Logger LOG = LoggerFactory.getLogger(GroupEndService.class);

    private final InterviewGroupRepository groups;
    private final InterviewGroupParticipantRepository participants;
    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final SessionEnder ender;
    private final InterviewRoom rooms;
    private final GroupTurnFlow flow;
    private final GroupRoomUpdates roomUpdates;
    private final GroupDraftStore drafts;
    private final TransactionTemplate transactions;
    private final Duration videoLimit;
    private final Duration chatLimit;
    private final Duration stallLimit;

    public GroupEndService(
            InterviewGroupRepository groups,
            InterviewGroupParticipantRepository participants,
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            SessionEnder ender,
            InterviewRoom rooms,
            GroupTurnFlow flow,
            GroupRoomUpdates roomUpdates,
            GroupDraftStore drafts,
            TransactionTemplate transactions,
            @Value("${group.cleanup.video-limit:60m}") Duration videoLimit,
            @Value("${group.cleanup.chat-limit:100m}") Duration chatLimit,
            @Value("${group.cleanup.stall-limit:5m}") Duration stallLimit) {
        this.groups = groups;
        this.participants = participants;
        this.sessions = sessions;
        this.questions = questions;
        this.ender = ender;
        this.rooms = rooms;
        this.flow = flow;
        this.roomUpdates = roomUpdates;
        this.drafts = drafts;
        this.transactions = transactions;
        this.videoLimit = videoLimit;
        this.chatLimit = chatLimit;
        this.stallLimit = stallLimit;
    }

    /**
     * 5.8. 내 면접만 끝내고 나머지는 계속한다(API 명세 10.10). 질문을 모두 마친 뒤면 ALL_ANSWERED, 아니면 USER_ENDED로 남긴다. 이미
     * 끝났거나 진행 중이 아니면 409 INVALID_SESSION_STATE. 면접의 소유는 부르는 쪽(InterviewSessionService)이 확인한다.
     */
    public SessionResponse endByUser(
            long userId, long groupId, long sessionId, BigDecimal gazeRatio) {
        return endSession(groupId, sessionId, gazeRatio, false);
    }

    /**
     * 질문을 모두 마치고 doneGrace 안에 5.8이 없는 면접을 BE가 끝낸다(ALL_ANSWERED, docs/그룹면접-설계.md 6.10 · 6.11). 그 사이
     * 끝났으면 아무것도 하지 않는다.
     *
     * @return 끝냈으면 true
     */
    public boolean endAfterDone(long groupId, long sessionId) {
        return endSession(groupId, sessionId, null, true) != null;
    }

    // 5.8과 완료 뒤 자동 종료가 같은 처리를 탄다. 질문을 모두 마친 뒤면 ALL_ANSWERED, 아니면 USER_ENDED.
    // onlyDone이면 질문을 모두 마친 진행 중 면접만 끝내고, 아니면 null 대신 409를 던진다
    private SessionResponse endSession(
            long groupId, long sessionId, BigDecimal gazeRatio, boolean onlyDone) {
        OffsetDateTime now = OffsetDateTime.now();
        Ended ended =
                transactions.execute(
                        status -> {
                            InterviewGroup group = lockGroup(groupId);
                            List<InterviewSession> locked = lockSessions(groupId);
                            List<InterviewGroupParticipant> active =
                                    participants.findActiveByGroupId(groupId);
                            InterviewGroupParticipant participant =
                                    active.stream()
                                            .filter(p -> p.getSession().getId() == sessionId)
                                            .findFirst()
                                            .orElse(null);
                            if (onlyDone
                                    && (participant == null
                                            || !participant.isDone()
                                            || participant.getSession().getStatus()
                                                    != SessionStatus.IN_PROGRESS)) {
                                return null;
                            }
                            // 대기실에서 나간 참가자의 면접은 시작하지 않았다
                            if (participant == null) {
                                throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
                            }
                            SessionResponse response =
                                    ender.end(
                                            participant.getSession(),
                                            now,
                                            gazeRatio,
                                            participant.isDone()
                                                    ? EndReason.ALL_ANSWERED
                                                    : EndReason.USER_ENDED,
                                            false);
                            boolean groupEnded = endGroupIfLast(group, locked, now);
                            if (!groupEnded && group.getStatus() == GroupStatus.IN_PROGRESS) {
                                continueWithout(group, active, sessionId, now);
                            }
                            return new Ended(response, groupEnded);
                        });
        if (ended == null) {
            return null;
        }
        // 커밋 뒤 정리한다. 실패해도 던지지 않는다(방은 빈 방 시간이 지나면 닫힌다)
        if (ended.groupEnded()) {
            rooms.closeGroup(groupId);
        } else {
            rooms.removeGroupParticipant(groupId, sessionId);
        }
        return ended.response();
    }

    /**
     * 남은 진행 중 세션을 모두 끝내고 그룹을 끝낸다(AI 장애 · 안전장치, docs/그룹면접-설계.md 6.11). 그룹 행 → 면접 행을 잠근 트랜잭션 안에서 부른다.
     * 저장된 답변이 1개 이상이면 결과를 만들고(AI 장애면 부분 결과) 없으면 ABORTED다. 진행 중이던 답변 · 작성 중인 글은 저장하지 않는다. 커밋 뒤 끝난
     * 면접방 정보(groupStatus ENDED · 참가자 endReason)를 보내 화면이 안내하게 한 다음 면접방을 지운다.
     */
    void endAll(
            InterviewGroup group,
            List<InterviewSession> locked,
            EndReason reason,
            OffsetDateTime now) {
        for (InterviewSession session : locked) {
            if (session.getStatus() == SessionStatus.IN_PROGRESS) {
                ender.end(session, now, null, reason, false);
            }
        }
        if (endGroupIfLast(group, locked, now)) {
            long groupId = group.getId();
            roomUpdates.publishAfterCommit(group, participants.findActiveByGroupId(groupId), now);
            afterCommit(() -> rooms.closeGroup(groupId));
        }
    }

    /**
     * 첫 질문 전에 AI를 연결하지 못했다(배정 거절 · AI 정체, docs/그룹면접-설계.md 5.1). 그룹과 세션을 START_FAILED로 바꾸고 면접방을 지운다.
     * 방은 잠근 채 지운다. 커밋 뒤에 지우면 그 사이 다시 시작해 연 방을 지울 수 있다(개인 면접의 배정 거절과 같다).
     */
    void failStart(InterviewGroup group, List<InterviewSession> locked) {
        group.failStart();
        for (InterviewSession session : locked) {
            if (session.getStatus() == SessionStatus.IN_PROGRESS) {
                session.failStart();
            }
        }
        rooms.closeGroup(group.getId());
    }

    /**
     * 안전장치(docs/그룹면접-설계.md 6.11). 시작한 지 화상 60분 · 채팅 100분이 지났고 마지막 진행 뒤 5분 동안 바뀐 것이 없는 그룹의 남은 세션을 모두
     * 끝낸다(CLEANUP). 정상 그룹은 질문마다 진행 시각이 바뀌므로 걸리지 않는다. 끝낸 그룹 수를 준다.
     */
    public int cleanupStalled(OffsetDateTime now) {
        List<Long> candidates =
                groups.findStalledIds(
                        GroupStatus.IN_PROGRESS,
                        now.minus(min(videoLimit, chatLimit)),
                        now.minus(stallLimit));
        int cleaned = 0;
        for (long groupId : candidates) {
            try {
                if (Boolean.TRUE.equals(transactions.execute(status -> cleanup(groupId, now)))) {
                    cleaned++;
                }
            } catch (RuntimeException ex) {
                // 한 그룹이 실패해도 다른 그룹은 정리한다. 다음 주기에 다시 본다
                LOG.warn("멈춘 그룹을 정리하지 못했다: group={}", groupId, ex);
            }
        }
        return cleaned;
    }

    // 남은 사람은 계속한다. 끝낸 사람이 지금 답변자면 답하던 질문은 그대로 두고 다음 차례로 넘긴다(6.10 3). 판단을 기다리던 꼬리질문도 버린다
    private void continueWithout(
            InterviewGroup group,
            List<InterviewGroupParticipant> active,
            long sessionId,
            OffsetDateTime now) {
        if (Long.valueOf(sessionId).equals(group.getTurnSessionId())) {
            Integer seq = group.getTurnSeq();
            flow.advance(group, active, false, now);
            if (seq != null) {
                questions
                        .findBySessionIdAndSeq(sessionId, seq)
                        .ifPresent(q -> drafts.delete(sessionId, q.getId()));
            }
        } else {
            group.touch(now);
        }
        roomUpdates.publishAfterCommit(group, active, now);
    }

    // 잠근 뒤 DB 값으로 다시 확인한다. 그 사이 진행됐거나 끝났으면 두지 않는다
    private boolean cleanup(long groupId, OffsetDateTime now) {
        InterviewGroup group = lockGroup(groupId);
        if (!isStalled(group, now)) {
            return false;
        }
        LOG.warn("멈춘 그룹을 정리했다: group={} startedAt={}", groupId, group.getStartedAt());
        endAll(group, lockSessions(groupId), EndReason.CLEANUP, now);
        return true;
    }

    private boolean isStalled(InterviewGroup group, OffsetDateTime now) {
        if (group.getStatus() != GroupStatus.IN_PROGRESS
                || group.getStartedAt() == null
                || group.getProgressedAt() == null) {
            return false;
        }
        Duration limit = group.getMode() == InterviewMode.VIDEO ? videoLimit : chatLimit;
        return !now.isBefore(group.getStartedAt().plus(limit))
                && !now.isBefore(group.getProgressedAt().plus(stallLimit));
    }

    // 그룹 종료 판단은 "그룹 세션 중 IN_PROGRESS가 없음" 하나다(5.3). 동시에 끝나도 그룹 행 잠금으로 하나씩 처리되어 한 번만 끝낸다
    private static boolean endGroupIfLast(
            InterviewGroup group, List<InterviewSession> locked, OffsetDateTime now) {
        if (group.getStatus() != GroupStatus.IN_PROGRESS
                || locked.stream().anyMatch(s -> s.getStatus() == SessionStatus.IN_PROGRESS)) {
            return false;
        }
        group.end(now);
        return true;
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

    private InterviewGroup lockGroup(long groupId) {
        return groups.findByIdForUpdate(groupId)
                .orElseThrow(() -> new IllegalStateException("그룹이 없다: " + groupId));
    }

    // 잠금 순서: 그룹 → 면접(id 순서, docs/그룹면접-설계.md 9장)
    private List<InterviewSession> lockSessions(long groupId) {
        return sessions.findAllForUpdate(participants.findActiveSessionIds(groupId));
    }

    private static Duration min(Duration a, Duration b) {
        return a.compareTo(b) <= 0 ? a : b;
    }

    private record Ended(SessionResponse response, boolean groupEnded) {}
}
