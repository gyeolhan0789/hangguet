package com.ssafy.a301.group.service;

import com.ssafy.a301.group.domain.GroupPhase;
import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.dto.GroupResultMessage;
import com.ssafy.a301.group.repository.InterviewGroupParticipantRepository;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.AnswerSpeech;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.domain.SttGap;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.service.AiJobService;
import com.ssafy.a301.interview.service.AiResultService.Outcome;
import com.ssafy.a301.interview.service.InvalidAiResultException;
import com.ssafy.a301.interview.service.VoiceAnswerChecks;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

/**
 * 그룹 면접 에이전트 결과 메시지 하나를 처리한다(ai:results:group, AI 명세 6.7, docs/그룹면접-설계.md 6.4). 그룹 행 → 면접 행(id 순서)을
 * 잠그고, 지금 차례 · 단계의 메시지일 때만 반영한 뒤 커밋하고 면접방 정보를 바꾼다. 늦게 왔거나 두 번 온 메시지는 차례 · 단계 · 버전이 맞지 않아 버린다.
 *
 * <p>기한이 지난 단계는 마감 처리기(GroupDeadlineService)가 처리한다.
 */
@Service
public class GroupResultService {
    private static final Logger LOG = LoggerFactory.getLogger(GroupResultService.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    // 그룹 면접의 질문 순서는 기본 4 + 꼬리질문 0~2개(docs/그룹면접-설계.md 4.3)
    private static final int MAX_SEQ =
            InterviewGroupParticipant.BASE_QUESTIONS + InterviewGroupParticipant.MAX_FOLLOWUPS;
    private static final Set<String> SPOKEN = Set.of("ENDED", "FAILED");
    // 배정 거절 이유(AI 명세 1.4)
    private static final Set<String> REJECT_REASONS = Set.of("INVALID_ASSIGNMENT");

    private final InterviewGroupRepository groups;
    private final InterviewGroupParticipantRepository participants;
    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final AnswerRepository answers;
    private final AiJobService aiJobs;
    private final GroupTurnFlow flow;
    private final GroupRoomUpdates roomUpdates;
    private final TransactionTemplate transactions;
    private final GroupMetrics metrics;
    private final GroupEndService groupEnds;

    public GroupResultService(
            InterviewGroupRepository groups,
            InterviewGroupParticipantRepository participants,
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            AnswerRepository answers,
            AiJobService aiJobs,
            GroupTurnFlow flow,
            GroupRoomUpdates roomUpdates,
            TransactionTemplate transactions,
            GroupMetrics metrics,
            GroupEndService groupEnds) {
        this.groups = groups;
        this.participants = participants;
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.aiJobs = aiJobs;
        this.flow = flow;
        this.roomUpdates = roomUpdates;
        this.transactions = transactions;
        this.metrics = metrics;
        this.groupEnds = groupEnds;
    }

    /**
     * @throws InvalidAiResultException 다시 처리해도 반영할 수 없는 메시지
     */
    public Outcome handle(String raw) {
        GroupResultMessage message = parse(raw);
        String type = required(message.type(), "type");
        if (type.equals("assignment.rejected")) {
            return assignmentRejected(message);
        }
        long sessionId = required(message.sessionId(), "sessionId");
        int seq = required(message.seq(), "seq");
        if (seq < 1 || seq > MAX_SEQ) {
            throw new InvalidAiResultException("seq는 1~6이다: " + seq);
        }
        int version = required(message.turnVersion(), "turnVersion");
        Step step =
                switch (type) {
                    case "question.started" -> questionStarted(message);
                    case "question.spoken" -> questionSpoken(message);
                    case "answer.completed" -> answerCompleted(message, sessionId, seq);
                    case "followup.decided" -> followupDecided(message);
                    default -> throw new InvalidAiResultException("처리하지 않는 결과 종류: " + type);
                };
        OffsetDateTime now = OffsetDateTime.now();
        Optional<Long> groupId = sessions.findGroupIdById(sessionId);
        Outcome outcome =
                groupId.isEmpty()
                        ? Outcome.DISCARDED
                        : transactions.execute(
                                status -> apply(groupId.get(), sessionId, seq, version, step, now));
        if (outcome == Outcome.DISCARDED) {
            LOG.info(
                    "그룹 면접 결과를 버렸다: {} session={} seq={} turnVersion={}",
                    type,
                    sessionId,
                    seq,
                    version);
        }
        return outcome;
    }

    private Outcome apply(
            long groupId, long sessionId, int seq, int version, Step step, OffsetDateTime now) {
        InterviewGroup group =
                groups.findByIdForUpdate(groupId)
                        .orElseThrow(() -> new IllegalStateException("그룹이 없다: " + groupId));
        List<InterviewSession> locked =
                sessions.findAllForUpdate(participants.findActiveSessionIds(groupId));
        List<InterviewGroupParticipant> active = participants.findActiveByGroupId(groupId);
        InterviewSession session =
                locked.stream().filter(s -> s.getId() == sessionId).findFirst().orElse(null);
        Turn turn = new Turn(group, active, session, seq, now);
        boolean current =
                session != null
                        && session.getStatus() == SessionStatus.IN_PROGRESS
                        && group.isCurrentTurn(sessionId, seq, version);
        if (!step.apply(turn, current)) {
            return Outcome.DISCARDED;
        }
        roomUpdates.publishAfterCommit(group, active, now);
        return Outcome.SAVED;
    }

    // 질문 행은 에이전트가 말하기 시작할 때 실제로 출제한 질문으로 만든다(개인 면접과 같다)
    private Step questionStarted(GroupResultMessage message) {
        OffsetDateTime startedAt = required(message.startedAt(), "startedAt");
        if (isBlank(message.content()) || isBlank(message.criteria())) {
            throw new InvalidAiResultException("질문 글 · 채점 기준이 비었다");
        }
        if (message.speechMs() != null && message.speechMs() < 0) {
            throw new InvalidAiResultException("speechMs는 0 이상이다: " + message.speechMs());
        }
        return (turn, current) -> {
            InterviewGroup group = turn.group();
            if (!current
                    || !group.isPhase(GroupPhase.ASKING)
                    || startedAt.isBefore(group.getStartedAt())) {
                return false;
            }
            Optional<InterviewQuestion> asked = question(turn);
            if (asked.isEmpty()) {
                questions.save(
                        InterviewQuestion.groupTurn(
                                turn.session(),
                                turn.seq(),
                                group.getTurnKind(),
                                message.content(),
                                message.criteria(),
                                message.promptVersion(),
                                message.modelVersion(),
                                startedAt));
            } else if (isAbandoned(asked.get())) {
                // 답변 중 나갔다 돌아온 사람에게 같은 질문을 다시 묻는다(6.9). 질문 행은 처음 낸 것을 그대로 둔다
                asked.get().reask();
            } else {
                return false;
            }
            flow.startSpeaking(group, startedAt, message.speechMs(), turn.now());
            return true;
        };
    }

    // 질문 음성이 끝난(또는 실패한) 시각부터 답변 시간을 센다. 질문을 낸 시각보다 이르거나 지금보다 늦은 값은 그 범위로 맞춘다
    private Step questionSpoken(GroupResultMessage message) {
        OffsetDateTime endedAt = required(message.endedAt(), "endedAt");
        String speech =
                message.speech() != null && message.speech().isString()
                        ? message.speech().asString()
                        : null;
        if (!SPOKEN.contains(speech)) {
            throw new InvalidAiResultException("speech는 ENDED · FAILED다: " + speech);
        }
        return (turn, current) -> {
            if (!current || !turn.group().isPhase(GroupPhase.SPEAKING)) {
                return false;
            }
            InterviewQuestion question = question(turn).orElse(null);
            if (question == null) {
                return false;
            }
            OffsetDateTime spokenAt = clamp(endedAt, question.getCreatedAt(), turn.now());
            flow.startAnswering(turn.group(), question, spokenAt, turn.now());
            return true;
        };
    }

    // 화상 답변. 마감 뒤 자동 제출(TIME_LIMIT)도 질문이 닫히기 전이면 받는다. 저장하면 채점 작업을 넣는다
    private Step answerCompleted(GroupResultMessage message, long sessionId, int seq) {
        VoiceAnswerChecks.requireValid(message.content(), message.tokens(), sessionId, seq);
        OffsetDateTime answerStartedAt = required(message.answerStartedAt(), "answerStartedAt");
        AnswerSpeech speech =
                VoiceAnswerChecks.validTimeline(answerSpeech(message), sessionId, seq);
        List<SttGap> sttGaps = VoiceAnswerChecks.validSttGaps(message.sttGaps(), sessionId, seq);
        return (turn, current) -> {
            InterviewGroup group = turn.group();
            if (!current
                    || group.getMode() != InterviewMode.VIDEO
                    || !group.isPhase(GroupPhase.ANSWERING)) {
                return false;
            }
            InterviewQuestion question = question(turn).orElse(null);
            if (question == null
                    || question.isClosed()
                    || answers.existsByQuestionId(question.getId())) {
                return false;
            }
            Answer answer =
                    Answer.voice(
                            question,
                            message.content(),
                            message.tokens(),
                            speech,
                            sttGaps,
                            answerStartedAt);
            OffsetDateTime endedAt =
                    message.answerEndedAt() == null
                            ? turn.now()
                            : clamp(message.answerEndedAt(), answerStartedAt, turn.now());
            answer.recordEndedAt(endedAt);
            answers.save(answer);
            aiJobs.enqueue(AiJob.scoreAnswer(sessionId, answer.getId()));
            flow.finishQuestion(group, turn.active(), true, turn.now());
            return true;
        };
    }

    // DECIDING에서 온 첫 판단만 반영한다. 늦게 온 판단은 버리지만 응답 시간은 남긴다(6.4)
    private Step followupDecided(GroupResultMessage message) {
        boolean needed = required(message.needed(), "needed");
        return (turn, current) -> {
            boolean deciding = current && turn.group().isPhase(GroupPhase.DECIDING);
            recordDecision(turn, deciding ? (needed ? "needed" : "not_needed") : "late");
            LOG.info(
                    "꼬리질문 판단: session={} seq={} needed={} receivedAt={} generationMs={}",
                    turn.session() == null ? null : turn.session().getId(),
                    turn.seq(),
                    needed,
                    message.receivedAt(),
                    message.generationMs());
            if (!deciding) {
                return false;
            }
            // 꼬리질문 글은 에이전트가 들고 있다가 그 사람의 FOLLOWUP 차례에 말한다(question.started로 저장)
            boolean usable = needed && !isBlank(message.content()) && !isBlank(message.criteria());
            if (needed && !usable) {
                LOG.warn("꼬리질문 글 · 채점 기준이 비어 꼬리질문 없이 넘어간다: session={}", turn.session().getId());
            }
            flow.advance(turn.group(), turn.active(), usable, turn.now());
            return true;
        };
    }

    // 에이전트가 그룹 배정을 거절했다(AI 명세 6.7). 질문을 내기 전인 그룹만 START_FAILED로 바꾸고 면접방을 지운다.
    // 다시 시작(10.7)하기 전에 보낸 거절이 늦게 오면 새 시도를 실패시키지 않게 버린다
    private Outcome assignmentRejected(GroupResultMessage message) {
        long groupId = required(message.groupId(), "groupId");
        String reason = required(message.reason(), "reason");
        if (!REJECT_REASONS.contains(reason)) {
            throw new InvalidAiResultException("배정 거절 이유가 아니다: " + reason);
        }
        OffsetDateTime occurredAt = required(message.occurredAt(), "occurredAt");
        LOG.warn("그룹 면접방 배정 거절: group={} reason={}", groupId, reason);
        return transactions.execute(
                status -> {
                    InterviewGroup group = groups.findByIdForUpdate(groupId).orElse(null);
                    if (group == null
                            || group.getStatus() != GroupStatus.IN_PROGRESS
                            || occurredAt.isBefore(group.getStartedAt())) {
                        return Outcome.DISCARDED;
                    }
                    List<Long> sessionIds = participants.findActiveSessionIds(groupId);
                    List<InterviewSession> locked = sessions.findAllForUpdate(sessionIds);
                    if (participants.hasAskedQuestion(groupId)) {
                        return Outcome.DISCARDED;
                    }
                    groupEnds.failStart(group, locked);
                    return Outcome.SAVED;
                });
    }

    // 최종 답변을 저장한 때(DECIDING 시작)부터 판단이 도착한 때까지
    private void recordDecision(Turn turn, String outcome) {
        if (turn.session() == null) {
            return;
        }
        question(turn)
                .flatMap(q -> answers.findByQuestionId(q.getId()))
                .ifPresent(
                        answer ->
                                metrics.followupDecision(
                                        outcome, answer.getCreatedAt(), turn.now()));
    }

    // 답변 중 이탈해 닫지도 답하지도 않은 채 남은 질문
    private boolean isAbandoned(InterviewQuestion question) {
        return !question.isClosed() && answers.findByQuestionId(question.getId()).isEmpty();
    }

    private Optional<InterviewQuestion> question(Turn turn) {
        return questions.findBySessionIdAndSeq(turn.session().getId(), turn.seq());
    }

    private static AnswerSpeech answerSpeech(GroupResultMessage message) {
        if (message.speech() == null || message.speech().isNull()) {
            return null;
        }
        try {
            return JSON.treeToValue(message.speech(), AnswerSpeech.class);
        } catch (JacksonException | IllegalArgumentException ex) {
            throw new InvalidAiResultException("speech 형식이 맞지 않다", ex);
        }
    }

    private static OffsetDateTime clamp(
            OffsetDateTime value, OffsetDateTime min, OffsetDateTime max) {
        if (value.isBefore(min)) {
            return min;
        }
        return value.isAfter(max) ? max : value;
    }

    private static GroupResultMessage parse(String raw) {
        try {
            return JSON.readValue(raw, GroupResultMessage.class);
        } catch (JacksonException ex) {
            throw new InvalidAiResultException("결과 메시지를 읽을 수 없다", ex);
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static <T> T required(T value, String field) {
        if (value == null) {
            throw new InvalidAiResultException("필수 필드가 없다: " + field);
        }
        return value;
    }

    /** 잠근 뒤의 그룹 상태. session은 나간 참가자의 면접이면 null이다 */
    private record Turn(
            InterviewGroup group,
            List<InterviewGroupParticipant> active,
            InterviewSession session,
            int seq,
            OffsetDateTime now) {}

    /** 메시지 하나의 반영. 잠근 뒤 부르며 반영했으면 true. current는 지금 차례 · 버전의 메시지인지 */
    @FunctionalInterface
    private interface Step {
        boolean apply(Turn turn, boolean current);
    }
}
