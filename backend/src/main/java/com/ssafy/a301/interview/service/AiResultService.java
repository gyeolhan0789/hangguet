package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.AnswerToken;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.AiResultMessage;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.SessionRuntimeStore;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.stream.IntStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

/**
 * AI 결과 메시지 하나를 저장한다(AI 명세 1.4, BE 설계 5.5). 같은 메시지가 두 번 오거나 늦게 와도 결과가 같도록 상태 조건과 유일 제약으로 거른다. 결과
 * 생성·녹화 합치기 결과(evaluation.*·recording.*)는 아직 받지 않는다.
 */
@Service
public class AiResultService {
    private static final Logger LOG = LoggerFactory.getLogger(AiResultService.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    // 답변 글 길이(UTF-16, 5.7 VOICE와 같음)와 토큰 수 상한(AI 명세 6.2)
    private static final int MAX_ANSWER_LENGTH = 10_000;
    private static final int MAX_TOKEN_COUNT = 10_000;

    /** 처리 결과. 둘 다 처리를 끝낸 것이라 큐에서 지운다 */
    public enum Outcome {
        SAVED,
        DISCARDED
    }

    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final AnswerRepository answers;
    private final InterviewPlanRepository plans;
    private final SessionRuntimeStore runtimes;
    private final AiJobService aiJobs;
    private final TransactionTemplate transactions;

    public AiResultService(
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            AnswerRepository answers,
            InterviewPlanRepository plans,
            SessionRuntimeStore runtimes,
            AiJobService aiJobs,
            TransactionTemplate transactions) {
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.plans = plans;
        this.runtimes = runtimes;
        this.aiJobs = aiJobs;
        this.transactions = transactions;
    }

    /**
     * @throws InvalidAiResultException 다시 처리해도 저장할 수 없는 메시지
     */
    public Outcome handle(String raw) {
        AiResultMessage message = parse(raw);
        long sessionId = required(message.sessionId(), "sessionId");
        Outcome outcome =
                switch (required(message.type(), "type")) {
                    case "plan.progress" ->
                            planProgress(sessionId, required(message.progress(), "progress"));
                    case "plan.completed" -> planCompleted(sessionId, message);
                    case "plan.failed" -> planFailed(sessionId);
                    case "question.started" -> questionStarted(sessionId, message);
                    case "answer.completed" -> answerCompleted(sessionId, message);
                    case "answer.scored" -> answerScored(sessionId, message);
                    default ->
                            throw new InvalidAiResultException("처리하지 않는 결과 종류: " + message.type());
                };
        if (outcome == Outcome.DISCARDED) {
            LOG.info("AI 결과를 버렸다(상태·중복): {} session={}", message.type(), sessionId);
        }
        return outcome;
    }

    private Outcome planProgress(long sessionId, int progress) {
        if (!isPlanGenerating(sessionId)) {
            return Outcome.DISCARDED;
        }
        runtimes.updatePlanProgress(sessionId, progress);
        return Outcome.SAVED;
    }

    // 이미 플랜이 있거나 GENERATING이 아니면(재생성 전 늦게 온 결과, 시간 초과로 실패 처리됨) 버린다
    private Outcome planCompleted(long sessionId, AiResultMessage message) {
        List<PlanQuestion> planQuestions = required(message.questions(), "questions");
        boolean seqOneToFive =
                planQuestions.size() == InterviewPlan.QUESTION_COUNT
                        && IntStream.rangeClosed(1, InterviewPlan.QUESTION_COUNT)
                                .allMatch(
                                        seq ->
                                                planQuestions.stream()
                                                        .anyMatch(q -> q.seq() == seq));
        if (!seqOneToFive) {
            throw new InvalidAiResultException("질문은 seq 1~5로 5개여야 한다: session=" + sessionId);
        }
        // 질문 글·채점 기준이 비면 저장은 되지만 질문을 낼 때(question.started) 저장할 수 없다
        if (planQuestions.stream().anyMatch(q -> isBlank(q.content()) || isBlank(q.criteria()))) {
            throw new InvalidAiResultException("질문 글·채점 기준이 비었다: session=" + sessionId);
        }
        if (!isPlanGenerating(sessionId) || !sessions.existsById(sessionId)) {
            return Outcome.DISCARDED;
        }
        if (plans.existsById(sessionId)) {
            // 지난번에 플랜을 저장하고 READY를 남기지 못했다. 이미 있는 플랜으로 READY를 남긴다
            runtimes.markPlanReady(sessionId);
            return Outcome.DISCARDED;
        }
        transactions.executeWithoutResult(
                status ->
                        plans.save(
                                new InterviewPlan(
                                        sessionId,
                                        required(message.claims(), "claims"),
                                        planQuestions,
                                        required(message.promptVersion(), "promptVersion"),
                                        required(message.modelVersion(), "modelVersion"))));
        runtimes.markPlanReady(sessionId);
        return Outcome.SAVED;
    }

    private Outcome planFailed(long sessionId) {
        if (!isPlanGenerating(sessionId)) {
            return Outcome.DISCARDED;
        }
        runtimes.failPlanIfGenerating(sessionId);
        return Outcome.SAVED;
    }

    // 질문 행은 에이전트가 말하기 시작할 때 만든다. 같은 seq가 있거나 면접 중이 아니면 버린다
    private Outcome questionStarted(long sessionId, AiResultMessage message) {
        int seq = requiredSeq(message);
        return transactions.execute(
                status -> {
                    InterviewSession session = lockInProgress(sessionId);
                    if (session == null
                            || questions.findBySessionIdAndSeq(sessionId, seq).isPresent()) {
                        return Outcome.DISCARDED;
                    }
                    String content =
                            plans.findById(sessionId)
                                    .flatMap(plan -> plan.question(seq))
                                    .map(PlanQuestion::content)
                                    .orElseThrow(
                                            () ->
                                                    new InvalidAiResultException(
                                                            "플랜에 "
                                                                    + seq
                                                                    + "번 질문이 없다: session="
                                                                    + sessionId));
                    questions.save(
                            new InterviewQuestion(
                                    session,
                                    seq,
                                    content,
                                    required(message.startedAt(), "startedAt")));
                    return Outcome.SAVED;
                });
    }

    // 화상 답변. 질문 하나에 답변 하나이며(5.7과 같은 규칙), 저장하면 채점 작업을 넣는다
    private Outcome answerCompleted(long sessionId, AiResultMessage message) {
        int seq = requiredSeq(message);
        String content = required(message.content(), "content");
        if (content.isBlank() || content.length() > MAX_ANSWER_LENGTH) {
            throw new InvalidAiResultException(
                    "답변 글은 1~10,000자다: session=" + sessionId + " seq=" + seq);
        }
        List<AnswerToken> tokens = message.tokens();
        if (tokens != null
                && (tokens.size() > MAX_TOKEN_COUNT
                        || tokens.stream()
                                .anyMatch(t -> t.startMs() < 0 || t.startMs() > t.endMs()))) {
            throw new InvalidAiResultException(
                    "토큰은 10,000개 이하, 0 ≤ startMs ≤ endMs다: session=" + sessionId + " seq=" + seq);
        }
        OffsetDateTime answerStartedAt = required(message.answerStartedAt(), "answerStartedAt");
        return transactions.execute(
                status -> {
                    InterviewSession session = lockInProgress(sessionId);
                    if (session == null || !session.isVideo()) {
                        return Outcome.DISCARDED;
                    }
                    InterviewQuestion question =
                            questions.findBySessionIdAndSeq(sessionId, seq).orElse(null);
                    if (question == null || answers.existsByQuestionId(question.getId())) {
                        return Outcome.DISCARDED;
                    }
                    Answer answer =
                            answers.save(
                                    Answer.voice(
                                            question,
                                            content,
                                            tokens,
                                            message.speech(),
                                            answerStartedAt));
                    aiJobs.enqueue(AiJob.scoreAnswer(sessionId, answer.getId()));
                    return Outcome.SAVED;
                });
    }

    // 채점 결과는 비어 있을 때만 남긴다. 다른 면접의 답변이면 버린다
    private Outcome answerScored(long sessionId, AiResultMessage message) {
        long answerId = required(message.answerId(), "answerId");
        var evaluation = required(message.evaluation(), "evaluation");
        return transactions.execute(
                status -> {
                    Answer answer = answers.findById(answerId).orElse(null);
                    if (answer == null
                            || answer.getQuestion().getSession().getId() != sessionId
                            || !answer.recordEvaluation(evaluation)) {
                        return Outcome.DISCARDED;
                    }
                    return Outcome.SAVED;
                });
    }

    private boolean isPlanGenerating(long sessionId) {
        return runtimes.find(sessionId)
                .map(runtime -> runtime.planStatus() == PlanStatus.GENERATING)
                .orElse(false);
    }

    // 면접 행을 잠근다. 없거나 면접 중이 아니면 null
    private InterviewSession lockInProgress(long sessionId) {
        return sessions.findByIdForUpdate(sessionId)
                .filter(session -> session.getStatus() == SessionStatus.IN_PROGRESS)
                .orElse(null);
    }

    private static int requiredSeq(AiResultMessage message) {
        int seq = required(message.seq(), "seq");
        if (seq < 1 || seq > InterviewPlan.QUESTION_COUNT) {
            throw new InvalidAiResultException("seq는 1~5다: " + seq);
        }
        return seq;
    }

    private static AiResultMessage parse(String raw) {
        try {
            return JSON.readValue(raw, AiResultMessage.class);
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
}
