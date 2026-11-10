package com.ssafy.a301.group.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.group.domain.GroupPhase;
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
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.AnswerResponse;
import com.ssafy.a301.interview.mapper.InterviewMapper;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.service.AiJobService;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 지원자가 부르는 그룹 면접 진행 API(API 명세 10.8 · 10.9 · 10.10의 5.7, docs/그룹면접-설계.md 6.6 · 6.7). 상태를 바꾸는 요청은 그룹
 * 행 → 면접 행(id 순서)을 잠그고 지금 차례 · 마감을 다시 확인한다. 면접의 소유는 부르는 쪽이 확인한다.
 */
@Service
public class GroupTurnService {
    private final InterviewGroupRepository groups;
    private final InterviewGroupParticipantRepository participants;
    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final AnswerRepository answers;
    private final AiJobService aiJobs;
    private final GroupDraftStore drafts;
    private final GroupTurnFlow flow;
    private final GroupRoomUpdates roomUpdates;
    private final TransactionTemplate transactions;
    private final Duration extendTime;
    private final Duration extendWindow;

    public GroupTurnService(
            InterviewGroupRepository groups,
            InterviewGroupParticipantRepository participants,
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            AnswerRepository answers,
            AiJobService aiJobs,
            GroupDraftStore drafts,
            GroupTurnFlow flow,
            GroupRoomUpdates roomUpdates,
            TransactionTemplate transactions,
            @Value("${group.extend-time:1m}") Duration extendTime,
            @Value("${group.extend-window:30s}") Duration extendWindow) {
        this.groups = groups;
        this.participants = participants;
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.aiJobs = aiJobs;
        this.drafts = drafts;
        this.flow = flow;
        this.roomUpdates = roomUpdates;
        this.transactions = transactions;
        this.extendTime = extendTime;
        this.extendWindow = extendWindow;
    }

    /**
     * 그룹 채팅 면접의 5.7(API 명세 10.10). 지금 내 차례이고 마감 전인 질문만 받는다. 저장하면 채점 작업을 넣고, 꼬리질문 판단(DECIDING) 또는 다음
     * 차례로 넘긴다. 마감 자동 제출과 겹쳐도 그룹 행 잠금으로 하나만 저장된다.
     */
    public AnswerResponse submitChat(
            long groupId, long sessionId, long questionId, String content) {
        OffsetDateTime now = OffsetDateTime.now(KoreaTime.ZONE);
        return transactions.execute(
                status -> {
                    Locked locked = lock(groupId, sessionId);
                    InterviewQuestion question = requireQuestion(sessionId, questionId);
                    if (answers.existsByQuestionId(questionId)) {
                        throw new ApiException(ErrorCode.ANSWER_ALREADY_SUBMITTED);
                    }
                    InterviewGroup group = locked.group();
                    if (!isOpenTurn(group, question, now)) {
                        throw new ApiException(ErrorCode.QUESTION_CLOSED);
                    }
                    Answer answer = new Answer(question, InputType.TEXT, content);
                    answer.recordEndedAt(now);
                    answers.save(answer);
                    aiJobs.enqueue(AiJob.scoreAnswer(sessionId, answer.getId()));
                    boolean deciding = flow.finishQuestion(group, locked.active(), true, now);
                    if (deciding) {
                        roomUpdates.sendAnswerAfterCommit(
                                group, sessionId, question.getSeq(), content);
                    }
                    roomUpdates.publishAfterCommit(group, locked.active(), now);
                    afterCommit(() -> drafts.delete(sessionId, questionId));
                    // 끝은 면접방 정보(DONE)로 안다
                    return InterviewMapper.toAnswerResponse(answer, false);
                });
    }

    /**
     * 10.8. 화상 그룹 면접에서 지금 답변자가 남은 시간이 30초 이하일 때 한 번 마감을 1분 늦춘다. 채팅 · 답변자가 아님 · 답변 중이 아님 · 30초 초과 ·
     * 이미 연장이면 409 EXTEND_NOT_ALLOWED.
     *
     * @return 새 마감
     */
    public OffsetDateTime extend(long userId, long groupId) {
        OffsetDateTime now = OffsetDateTime.now(KoreaTime.ZONE);
        return transactions.execute(
                status -> {
                    InterviewGroup group =
                            groups.findByIdForUpdate(groupId)
                                    .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
                    sessions.findAllForUpdate(participants.findActiveSessionIds(groupId));
                    List<InterviewGroupParticipant> active =
                            participants.findActiveByGroupId(groupId);
                    long sessionId =
                            GroupResponses.participant(active, userId).getSession().getId();
                    OffsetDateTime deadline = group.getDeadlineAt();
                    boolean allowed =
                            group.getMode() == InterviewMode.VIDEO
                                    && group.isPhase(GroupPhase.ANSWERING)
                                    && Long.valueOf(sessionId).equals(group.getTurnSessionId())
                                    && !group.isExtended()
                                    && deadline != null
                                    && now.isBefore(deadline)
                                    && !now.plus(extendWindow).isBefore(deadline);
                    if (!allowed) {
                        throw new ApiException(ErrorCode.EXTEND_NOT_ALLOWED);
                    }
                    OffsetDateTime extended = deadline.plus(extendTime);
                    questions
                            .findBySessionIdAndSeq(sessionId, group.getTurnSeq())
                            .ifPresent(q -> q.extendDeadline(extended));
                    group.extend(now, extended, flow.answeringDue(group, extended));
                    roomUpdates.publishAfterCommit(group, active, now);
                    return extended;
                });
    }

    /**
     * 10.9. 채팅 그룹 면접의 작성 중인 글을 덮어쓴다. 최종 답변이 아니다. 지금 내가 답할 질문이고 마감 전 · 답하기 전일 때만 저장한다. 잠그지 않는다(마감
     * 확정은 잠근 뒤 마지막으로 저장된 글을 쓴다).
     */
    public void saveDraft(long groupId, long sessionId, long questionId, String content) {
        OffsetDateTime now = OffsetDateTime.now(KoreaTime.ZONE);
        InterviewQuestion question = requireQuestion(sessionId, questionId);
        InterviewGroup group =
                groups.findById(groupId)
                        .orElseThrow(() -> new ApiException(ErrorCode.QUESTION_CLOSED));
        if (group.getMode() != InterviewMode.CHAT
                || !isOpenTurn(group, question, now)
                || answers.existsByQuestionId(questionId)) {
            throw new ApiException(ErrorCode.QUESTION_CLOSED);
        }
        drafts.save(sessionId, questionId, content);
    }

    /** 그룹 면접의 5.5. 답하지 않았고 마감되지 않은 마지막 질문. 다음 내 차례를 기다리면 비어 있고, 내 질문을 모두 마쳤으면 409 */
    public Optional<InterviewQuestion> currentQuestion(long sessionId) {
        if (participants.existsBySessionIdAndDoneAtIsNotNull(sessionId)) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        return questions
                .findFirstBySessionIdOrderBySeqDesc(sessionId)
                .filter(q -> !q.isClosed() && !answers.existsByQuestionId(q.getId()));
    }

    // 지금 차례의 답변 중인 질문이고 마감 전이다
    private static boolean isOpenTurn(
            InterviewGroup group, InterviewQuestion question, OffsetDateTime now) {
        return group.isPhase(GroupPhase.ANSWERING)
                && question.getSession().getId().equals(group.getTurnSessionId())
                && Integer.valueOf(question.getSeq()).equals(group.getTurnSeq())
                && !question.isClosed()
                && group.getDeadlineAt() != null
                && now.isBefore(group.getDeadlineAt());
    }

    // 잠금 순서: 그룹 → 면접(id 순서). 내 면접이 진행 중이어야 한다
    private Locked lock(long groupId, long sessionId) {
        InterviewGroup group =
                groups.findByIdForUpdate(groupId)
                        .orElseThrow(() -> new IllegalStateException("그룹이 없다: " + groupId));
        List<InterviewSession> locked =
                sessions.findAllForUpdate(participants.findActiveSessionIds(groupId));
        boolean inProgress =
                locked.stream()
                        .anyMatch(
                                s ->
                                        s.getId() == sessionId
                                                && s.getStatus() == SessionStatus.IN_PROGRESS);
        if (!inProgress) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        return new Locked(group, participants.findActiveByGroupId(groupId));
    }

    // 경로의 면접에 속하고 이미 낸 질문이어야 한다
    private InterviewQuestion requireQuestion(long sessionId, long questionId) {
        return questions
                .findById(questionId)
                .filter(question -> question.getSession().getId() == sessionId)
                .orElseThrow(() -> new ApiException(ErrorCode.QUESTION_NOT_FOUND));
    }

    /**
     * 5.14 그룹 면접 재입장. 진행 중 이탈한 사람은 2분 안에만 다시 들어올 수 있다(docs/그룹면접-설계.md 6.9). 2분이 지났으면 마감 처리기가 끝내기
     * 전이라도 409 INVALID_SESSION_STATE.
     */
    public void requireRejoinable(long sessionId) {
        participants
                .findBySessionId(sessionId)
                .filter(p -> p.isAbsentTooLong(OffsetDateTime.now(KoreaTime.ZONE)))
                .ifPresent(
                        p -> {
                            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
                        });
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

    private record Locked(InterviewGroup group, List<InterviewGroupParticipant> active) {}
}
