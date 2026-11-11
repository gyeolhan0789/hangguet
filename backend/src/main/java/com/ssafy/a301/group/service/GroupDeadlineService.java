package com.ssafy.a301.group.service;

import com.ssafy.a301.group.domain.GroupPhase;
import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.repository.GroupDraftStore;
import com.ssafy.a301.group.repository.InterviewGroupParticipantRepository;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.service.AiJobService;
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
 * 그룹 면접 마감 처리기(docs/그룹면접-설계.md 6.11). 기한이 지난 그룹마다 그룹 행 → 면접 행을 잠그고 DB 값으로 기한을 다시 확인한 뒤 처리한다. 그 사이
 * 진행된 그룹은 건드리지 않으므로 여러 BE에서 돌아도 같다. 한 그룹이 실패해도 다른 그룹은 처리하고 다음 주기에 다시 본다.
 *
 * <ul>
 *   <li>SPEAKING: 질문 음성이 끝났다는 메시지가 오지 않았다. 지금부터 답변 시간을 시작한다(장애가 아니다)
 *   <li>ANSWERING: 마감. 채팅은 작성 중인 글로 최종 답변을 확정하고, 글이 없거나 화상이면 답 없이 질문을 닫는다
 *   <li>DECIDING: 꼬리질문 판단이 오지 않았다. 꼬리질문 없이 다음 차례로 간다(장애가 아니다)
 *   <li>ASKING: 면접방 정보를 한 번 더 보내고 기다린다. 그래도 질문이 시작되지 않으면 AI 정체다. 질문을 하나도 내지 않았으면 시작 실패, 냈으면 AI 장애로
 *       남은 면접을 모두 끝낸다
 *   <li>질문을 모두 마치고 doneGrace 안에 5.8이 없으면 ALL_ANSWERED로 끝낸다
 *   <li>이탈한 지 2분이 지나도 돌아오지 않으면 DISCONNECTED로 끝낸다(6.9). WAITING도 이것으로 풀린다
 *   <li>면접방 정보 · 채팅 답변 보내기가 실패했으면 다시 보낸다(6.5 · 6.14)
 * </ul>
 */
@Service
public class GroupDeadlineService {
    private static final Logger LOG = LoggerFactory.getLogger(GroupDeadlineService.class);

    private final InterviewGroupRepository groups;
    private final InterviewGroupParticipantRepository participants;
    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final AnswerRepository answers;
    private final AiJobService aiJobs;
    private final GroupDraftStore drafts;
    private final GroupTurnFlow flow;
    private final GroupRoomUpdates roomUpdates;
    private final GroupEndService groupEnds;
    private final GroupMetrics metrics;
    private final TransactionTemplate transactions;
    private final Duration askingTimeout;
    private final Duration askingRetry;
    private final Duration doneGrace;

    public GroupDeadlineService(
            InterviewGroupRepository groups,
            InterviewGroupParticipantRepository participants,
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            AnswerRepository answers,
            AiJobService aiJobs,
            GroupDraftStore drafts,
            GroupTurnFlow flow,
            GroupRoomUpdates roomUpdates,
            GroupEndService groupEnds,
            GroupMetrics metrics,
            TransactionTemplate transactions,
            @Value("${group.asking-timeout:20s}") Duration askingTimeout,
            @Value("${group.asking-retry:10s}") Duration askingRetry,
            @Value("${group.done-grace:60s}") Duration doneGrace) {
        this.groups = groups;
        this.participants = participants;
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.aiJobs = aiJobs;
        this.drafts = drafts;
        this.flow = flow;
        this.roomUpdates = roomUpdates;
        this.groupEnds = groupEnds;
        this.metrics = metrics;
        this.transactions = transactions;
        this.askingTimeout = askingTimeout;
        this.askingRetry = askingRetry;
        this.doneGrace = doneGrace;
    }

    /** 한 주기. 기한이 지난 단계 → 완료 뒤 5.8 없음 → 이탈 2분 초과 → 보내지 못한 면접방 정보 · 채팅 답변 순서로 본다 */
    public void tick(OffsetDateTime now) {
        for (long groupId : groups.findDueIds(now)) {
            safely("단계 기한", groupId, () -> expire(groupId, now));
        }
        for (Object[] row : participants.findOverdueDone(now.minus(doneGrace))) {
            long groupId = (Long) row[0];
            long sessionId = (Long) row[1];
            safely("완료 뒤 종료", groupId, () -> groupEnds.endAfterDone(groupId, sessionId));
        }
        for (Object[] row : participants.findOverdueAbsent(now)) {
            long groupId = (Long) row[0];
            long sessionId = (Long) row[1];
            safely("이탈 종료", groupId, () -> groupEnds.endDisconnected(groupId, sessionId));
        }
        for (long groupId : groups.findUnsyncedIds()) {
            safely("면접방 정보 재전송", groupId, () -> resync(groupId, now));
        }
        for (long groupId : groups.findAnswerUnsentIds()) {
            safely("채팅 답변 재전송", groupId, () -> resendAnswer(groupId));
        }
    }

    /** 그룹 하나의 단계 기한을 처리한다. 잠근 뒤 기한을 다시 확인하므로 그 사이 다음 단계로 갔으면 아무것도 하지 않는다 */
    public void expire(long groupId, OffsetDateTime now) {
        transactions.executeWithoutResult(status -> expireLocked(groupId, now));
    }

    private void expireLocked(long groupId, OffsetDateTime now) {
        InterviewGroup group = groups.findByIdForUpdate(groupId).orElse(null);
        if (group == null
                || group.getStatus() != GroupStatus.IN_PROGRESS
                || group.getPhaseDueAt() == null
                || group.getPhaseDueAt().isAfter(now)) {
            return;
        }
        List<InterviewSession> locked =
                sessions.findAllForUpdate(participants.findActiveSessionIds(groupId));
        List<InterviewGroupParticipant> active = participants.findActiveByGroupId(groupId);
        GroupPhase phase = group.getPhase();
        if (phase == GroupPhase.ASKING) {
            expireAsking(group, locked, active, now);
            return;
        }
        Optional<InterviewQuestion> question = currentQuestion(group);
        switch (phase) {
            case SPEAKING -> {
                // question.started로 SPEAKING이 됐으므로 질문 행이 있다
                InterviewQuestion q = question.orElseThrow();
                LOG.info("질문 음성이 끝났다는 메시지가 없어 답변 시간을 시작한다: group={}", groupId);
                flow.startAnswering(group, q, now, now);
            }
            case ANSWERING -> closeAnswering(group, active, question.orElseThrow(), now);
            case DECIDING -> {
                question.flatMap(q -> answers.findByQuestionId(q.getId()))
                        .ifPresent(a -> metrics.followupDecision("missing", a.getCreatedAt(), now));
                flow.advance(group, active, false, now);
            }
            default -> {
                // WAITING은 기다리던 사람이 2분이 지나 끝나면(이탈 종료) 다음 차례를 다시 정한다
                return;
            }
        }
        roomUpdates.publishAfterCommit(group, active, now);
    }

    // 6.6 마감. 채팅은 마지막으로 저장된 작성 중인 글을 최종 답변으로 확정한다(답변을 끝낸 시각은 마감). 화상은 마감 뒤 여유 동안 에이전트의 자동 제출이
    // 오지 않았으므로 답 없이 닫는다
    private void closeAnswering(
            InterviewGroup group,
            List<InterviewGroupParticipant> active,
            InterviewQuestion question,
            OffsetDateTime now) {
        long sessionId = question.getSession().getId();
        String draft =
                group.getMode() == InterviewMode.CHAT
                        ? drafts.find(sessionId, question.getId())
                                .filter(d -> !d.isBlank())
                                .orElse(null)
                        : null;
        if (draft == null) {
            question.close(now);
            flow.finishQuestion(group, active, false, now);
        } else {
            Answer answer = new Answer(question, InputType.TEXT, draft);
            answer.recordEndedAt(group.getDeadlineAt());
            answers.save(answer);
            aiJobs.enqueue(AiJob.scoreAnswer(sessionId, answer.getId()));
            if (flow.finishQuestion(group, active, true, now)) {
                roomUpdates.sendAnswerAfterCommit(group, sessionId, question.getSeq(), draft);
            }
        }
        long questionId = question.getId();
        afterCommit(() -> drafts.delete(sessionId, questionId));
    }

    // ASKING 기한. 처음 지나면 에이전트가 면접방 정보를 놓쳤을 수 있어 한 번 더 보내고 askingRetry만큼 더 기다린다
    private void expireAsking(
            InterviewGroup group,
            List<InterviewSession> locked,
            List<InterviewGroupParticipant> active,
            OffsetDateTime now) {
        OffsetDateTime giveUpAt = group.getProgressedAt().plus(askingTimeout).plus(askingRetry);
        if (now.isBefore(giveUpAt)) {
            group.waitAsking(giveUpAt);
            roomUpdates.publishAfterCommit(group, active, now);
            return;
        }
        LOG.warn("AI 면접관이 질문을 시작하지 않는다: group={}", group.getId());
        groupEnds.stopForAiFailure(group, locked, now);
    }

    // 6.5 재동기화. 커밋된 지금 상태를 다시 보낸다
    private void resync(long groupId, OffsetDateTime now) {
        Optional<Sync> sync =
                Optional.ofNullable(
                        transactions.execute(
                                s ->
                                        groups.findById(groupId)
                                                .filter(
                                                        g ->
                                                                g.getStatus()
                                                                        == GroupStatus.IN_PROGRESS)
                                                .map(
                                                        g ->
                                                                new Sync(
                                                                        g.getTurnVersion(),
                                                                        GroupRoomUpdates.metadata(
                                                                                g,
                                                                                participants
                                                                                        .findActiveByGroupId(
                                                                                                groupId),
                                                                                now)))
                                                .orElse(null)));
        sync.ifPresent(s -> roomUpdates.publish(groupId, s.version(), s.payload()));
    }

    // 6.14 2. 꼬리질문 판단 중이면 저장한 채팅 최종 답변을 다시 보낸다. 에이전트가 (sessionId, seq)로 중복을 거른다
    private void resendAnswer(long groupId) {
        Optional<Sync> sync =
                Optional.ofNullable(
                        transactions.execute(
                                s -> {
                                    InterviewGroup group = groups.findById(groupId).orElse(null);
                                    if (group == null || !group.isPhase(GroupPhase.DECIDING)) {
                                        return null;
                                    }
                                    return currentQuestion(group)
                                            .flatMap(q -> answers.findByQuestionId(q.getId()))
                                            .map(
                                                    a ->
                                                            new Sync(
                                                                    group.getTurnVersion(),
                                                                    GroupRoomUpdates.answerPayload(
                                                                            group
                                                                                    .getTurnSessionId(),
                                                                            group.getTurnSeq(),
                                                                            a.getContent(),
                                                                            group
                                                                                    .getTurnVersion())))
                                            .orElse(null);
                                }));
        sync.ifPresent(s -> roomUpdates.sendAnswer(groupId, s.version(), s.payload()));
    }

    private Optional<InterviewQuestion> currentQuestion(InterviewGroup group) {
        if (group.getTurnSessionId() == null || group.getTurnSeq() == null) {
            return Optional.empty();
        }
        return questions.findBySessionIdAndSeq(group.getTurnSessionId(), group.getTurnSeq());
    }

    private static void safely(String what, long groupId, Runnable action) {
        try {
            action.run();
        } catch (RuntimeException ex) {
            LOG.warn("그룹 면접 {} 처리 실패: group={}", what, groupId, ex);
        }
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

    private record Sync(int version, String payload) {}
}
