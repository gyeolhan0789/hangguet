package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.AnswerSpeech;
import com.ssafy.a301.interview.domain.AnswerToken;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.domain.RecordingStatus;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.interview.domain.SttGap;
import com.ssafy.a301.interview.dto.AiResultMessage;
import com.ssafy.a301.interview.dto.AiResultMessage.CriterionScore;
import com.ssafy.a301.interview.dto.AiResultMessage.EvaluatedAnswer;
import com.ssafy.a301.interview.dto.AiResultMessage.SpeechMetrics;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.RecordingRepository;
import com.ssafy.a301.interview.repository.SessionRuntimeStore;
import com.ssafy.a301.interview.repository.SessionScoreRepository;
import com.ssafy.a301.interview.repository.SpeechMetricRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

/**
 * AI 결과 메시지 하나를 저장한다(AI 명세 1.4, BE 설계 5.5). 같은 메시지가 두 번 오거나 늦게 와도 결과가 같도록 상태 조건·마지막 EVALUATE
 * jobId·유일 제약으로 거른다.
 */
@Service
public class AiResultService {
    private static final Logger LOG = LoggerFactory.getLogger(AiResultService.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    // 답변 글 길이(UTF-16)와 토큰 수 상한(AI 명세 6.2)
    private static final int MAX_ANSWER_LENGTH = 10_000;
    private static final int MAX_TOKEN_COUNT = 10_000;
    // 총평·기준 코멘트(VARCHAR(255), 글자 수)
    private static final int MAX_COMMENT_LENGTH = 255;
    // interview_sessions.headline 길이. AI가 30자를 넘기면 자르지만(AI 명세 4장) 저장이 실패하지 않게 BE도 자른다
    private static final int MAX_HEADLINE_LENGTH = 30;
    // 말하기 지표 컬럼 NUMERIC(5, 2)
    private static final BigDecimal MAX_METRIC = new BigDecimal("999.99");
    // 배정 거절 이유(AI 명세 1.4). 이유로 처리를 나누지는 않지만 모르는 값은 실패 목록으로 보낸다
    private static final Set<String> REJECT_REASONS = Set.of("INVALID_ASSIGNMENT");

    /** 처리 결과. 둘 다 처리를 끝낸 것이라 큐에서 지운다 */
    public enum Outcome {
        SAVED,
        DISCARDED
    }

    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final AnswerRepository answers;
    private final InterviewPlanRepository plans;
    private final SessionScoreRepository sessionScores;
    private final SpeechMetricRepository speechMetrics;
    private final RecordingRepository recordings;
    private final SessionRuntimeStore runtimes;
    private final AiJobService aiJobs;
    private final InterviewRoom rooms;
    private final TransactionTemplate transactions;

    public AiResultService(
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            AnswerRepository answers,
            InterviewPlanRepository plans,
            SessionScoreRepository sessionScores,
            SpeechMetricRepository speechMetrics,
            RecordingRepository recordings,
            SessionRuntimeStore runtimes,
            AiJobService aiJobs,
            InterviewRoom rooms,
            TransactionTemplate transactions) {
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.plans = plans;
        this.sessionScores = sessionScores;
        this.speechMetrics = speechMetrics;
        this.recordings = recordings;
        this.runtimes = runtimes;
        this.aiJobs = aiJobs;
        this.rooms = rooms;
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
                    case "evaluation.progress" -> evaluationProgress(sessionId, message);
                    case "evaluation.completed" -> evaluationCompleted(sessionId, message);
                    case "evaluation.failed" -> evaluationFailed(sessionId, message);
                    case "recording.merged" -> recordingMerged(sessionId, message);
                    case "recording.mergeFailed" -> recordingMergeFailed(sessionId, message);
                    case "assignment.rejected" -> assignmentRejected(sessionId, message);
                    default ->
                            throw new InvalidAiResultException("처리하지 않는 결과 종류: " + message.type());
                };
        if (outcome == Outcome.DISCARDED) {
            LOG.info("AI 결과를 버렸다: {} session={}", message.type(), sessionId);
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

    // 이미 플랜이 있거나 GENERATING이 아니면(재생성 전 늦게 온 결과, 시간 초과로 실패 처리됨) 버린다.
    // 질문 수는 개인 면접 5개, 그룹 면접 2개다(AI 명세 2장 questionCount)
    private Outcome planCompleted(long sessionId, AiResultMessage message) {
        List<PlanQuestion> planQuestions = required(message.questions(), "questions");
        InterviewSession session = sessions.findById(sessionId).orElse(null);
        if (session == null) {
            return Outcome.DISCARDED;
        }
        int count = InterviewPlan.questionCount(session);
        boolean seqOneToCount =
                planQuestions.size() == count
                        && IntStream.rangeClosed(1, count)
                                .allMatch(
                                        seq ->
                                                planQuestions.stream()
                                                        .anyMatch(q -> q.seq() == seq));
        if (!seqOneToCount) {
            throw new InvalidAiResultException(
                    "질문은 seq 1~%d로 %d개여야 한다: session=%d".formatted(count, count, sessionId));
        }
        // 질문 글·채점 기준이 비면 저장은 되지만 질문을 낼 때(question.started) 저장할 수 없다
        if (planQuestions.stream().anyMatch(q -> isBlank(q.content()) || isBlank(q.criteria()))) {
            throw new InvalidAiResultException("질문 글·채점 기준이 비었다: session=" + sessionId);
        }
        if (!isPlanGenerating(sessionId)) {
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

    // 질문 행은 에이전트가 말하기 시작할 때 실제로 출제한 질문으로 만든다(꼬리질문은 플랜과 다르다, AI 명세 2.2).
    // 같은 seq가 있거나 면접 중이 아니면 버린다
    private Outcome questionStarted(long sessionId, AiResultMessage message) {
        int seq = requiredSeq(message);
        OffsetDateTime startedAt = required(message.startedAt(), "startedAt");
        if (isBlank(message.content()) || isBlank(message.criteria())) {
            throw new InvalidAiResultException(
                    "질문 글·채점 기준이 비었다: session=" + sessionId + ", seq=" + seq);
        }
        return transactions.execute(
                status -> {
                    InterviewSession session = lockInProgress(sessionId);
                    // 시작 시각보다 이른 질문은 시작 실패(AI 명세 6.5) 뒤 다시 시작하기 전 시도의 것이다(AI 명세 1.4)
                    if (session == null
                            || questions.findBySessionIdAndSeq(sessionId, seq).isPresent()
                            || startedAt.isBefore(session.getStartedAt())) {
                        return Outcome.DISCARDED;
                    }
                    questions.save(
                            new InterviewQuestion(
                                    session,
                                    seq,
                                    message.content(),
                                    message.criteria(),
                                    message.promptVersion(),
                                    message.modelVersion(),
                                    startedAt));
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
        AnswerSpeech speech = validTimeline(message.speech(), sessionId, seq);
        List<SttGap> sttGaps = validSttGaps(message.sttGaps(), sessionId, seq);
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
                                            speech,
                                            sttGaps,
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

    // 결과 생성 중이고 마지막으로 보낸 EVALUATE의 결과일 때만 단계를 남긴다
    private Outcome evaluationProgress(long sessionId, AiResultMessage message) {
        AnalysisStep step = required(message.analysisStep(), "analysisStep");
        String jobId = required(message.jobId(), "jobId");
        boolean analyzing =
                sessions.findById(sessionId)
                        .filter(session -> session.getStatus() == SessionStatus.ANALYZING)
                        .isPresent();
        if (!analyzing || !isLatestEvaluate(sessionId, jobId)) {
            return Outcome.DISCARDED;
        }
        runtimes.updateAnalysisStep(sessionId, step);
        return Outcome.SAVED;
    }

    // 한 트랜잭션에서 이 면접의 결과를 지우고 다시 쓴 뒤 COMPLETED로 바꾼다(AI 명세 4장)
    private Outcome evaluationCompleted(long sessionId, AiResultMessage message) {
        String jobId = required(message.jobId(), "jobId");
        String summary = withinCommentLength(required(message.summary(), "summary"), "summary");
        if (summary.isBlank()) {
            throw new InvalidAiResultException("총평이 비었다: session=" + sessionId);
        }
        String headline = headline(message.headline());
        List<EvaluatedAnswer> evaluated = required(message.answers(), "answers");
        List<CriterionScore> scores =
                validScores(required(message.sessionScores(), "sessionScores"));
        evaluated.forEach(AiResultService::validate);
        SpeechMetrics metrics = validMetrics(message.speechMetrics());
        Outcome outcome =
                transactions.execute(
                        status -> {
                            InterviewSession session = lockAnalyzing(sessionId, jobId);
                            if (session == null) {
                                return Outcome.DISCARDED;
                            }
                            Map<Long, Answer> byId =
                                    answers.findWithQuestionBySessionId(sessionId).stream()
                                            .collect(
                                                    Collectors.toMap(
                                                            Answer::getId, Function.identity()));
                            Set<Long> evaluatedIds =
                                    evaluated.stream()
                                            .map(EvaluatedAnswer::answerId)
                                            .collect(Collectors.toSet());
                            if (evaluatedIds.size() != evaluated.size()
                                    || !evaluatedIds.equals(byId.keySet())) {
                                throw new InvalidAiResultException(
                                        "이 면접의 답변마다 결과가 하나씩 있어야 한다: session=" + sessionId);
                            }
                            evaluated.forEach(
                                    result ->
                                            byId.get(result.answerId())
                                                    .completeEvaluation(
                                                            result.score(),
                                                            result.goodPoint(),
                                                            result.improvePoint(),
                                                            result.evaluation()));
                            sessionScores.deleteBySessionId(sessionId);
                            // 시선 비율은 AI가 아니라 5.8에서 받으므로 지우기 전에 읽어 새 행에 이어 쓴다
                            BigDecimal gazeRatio =
                                    speechMetrics.findGazeRatio(sessionId).orElse(null);
                            speechMetrics.deleteBySessionId(sessionId);
                            scores.forEach(
                                    score ->
                                            sessionScores.save(
                                                    new SessionScore(
                                                            session,
                                                            score.criterion(),
                                                            score.score(),
                                                            score.comment())));
                            if (session.isVideo() && (metrics != null || gazeRatio != null)) {
                                SpeechMetric metric =
                                        metrics == null
                                                ? new SpeechMetric(
                                                        session, null, null, null, null, null)
                                                : new SpeechMetric(
                                                        session,
                                                        metrics.fillerPerMin(),
                                                        metrics.longPauseCount(),
                                                        metrics.speedDeviationPct(),
                                                        metrics.trailingOffRatio(),
                                                        metrics.pitchRangeSt());
                                metric.recordGazeRatio(gazeRatio);
                                speechMetrics.save(metric);
                            }
                            session.complete(headline, summary);
                            return Outcome.SAVED;
                        });
        if (outcome == Outcome.SAVED) {
            runtimes.clearAnalysisStep(sessionId);
        }
        return outcome;
    }

    private Outcome evaluationFailed(long sessionId, AiResultMessage message) {
        String jobId = required(message.jobId(), "jobId");
        LOG.warn("결과 생성 실패: session={} reason={}", sessionId, message.reason());
        Outcome outcome =
                transactions.execute(
                        status -> {
                            InterviewSession session = lockAnalyzing(sessionId, jobId);
                            if (session == null) {
                                return Outcome.DISCARDED;
                            }
                            session.failAnalysis();
                            return Outcome.SAVED;
                        });
        if (outcome == Outcome.SAVED) {
            runtimes.clearAnalysisStep(sessionId);
        }
        return outcome;
    }

    // 합친 mp4는 면접마다 하나다. 화상 면접이 아니거나 이미 READY이면 버린다.
    // MERGING 행이 없는 면접(V10 이전에 끝남)은 READY 행을 새로 만든다.
    // 영상 0초 시각(recordingStartedAt)은 READY로 바꿀 때 함께 저장하고, 이어 붙여 합쳤으면 null이다
    private Outcome recordingMerged(long sessionId, AiResultMessage message) {
        String objectKey = required(message.objectKey(), "objectKey");
        if (!objectKey.equals(Recording.sessionVideoKey(sessionId))) {
            throw new InvalidAiResultException(
                    "이 면접의 녹화 위치가 아니다: session=" + sessionId + " objectKey=" + objectKey);
        }
        return transactions.execute(
                status -> {
                    InterviewSession session = sessions.findById(sessionId).orElse(null);
                    if (session == null || !session.isVideo()) {
                        return Outcome.DISCARDED;
                    }
                    Recording recording = recordings.findByObjectKey(objectKey).orElse(null);
                    if (recording == null) {
                        recordings.save(
                                Recording.mergedSessionVideo(
                                        session, message.recordingStartedAt()));
                        return Outcome.SAVED;
                    }
                    if (recording.getStatus() == RecordingStatus.READY) {
                        return Outcome.DISCARDED;
                    }
                    recording.markMerged(message.recordingStartedAt());
                    return Outcome.SAVED;
                });
    }

    // 다시보기(API 명세 6.4)가 FAILED로 응답하도록 MERGING 행을 FAILED로 변경한다.
    // 이미 READY이거나 행이 없으면(V10 이전에 끝남) 버린다. 행이 없는 면접은 6.4가 종료 시각으로 판단한다
    private Outcome recordingMergeFailed(long sessionId, AiResultMessage message) {
        LOG.warn("녹화 합치기 실패: session={} reason={}", sessionId, message.reason());
        return transactions.execute(
                status -> {
                    InterviewSession session = sessions.findById(sessionId).orElse(null);
                    if (session == null || !session.isVideo()) {
                        return Outcome.DISCARDED;
                    }
                    return recordings
                            .findByObjectKey(Recording.sessionVideoKey(sessionId))
                            .filter(Recording::markMergeFailed)
                            .map(recording -> Outcome.SAVED)
                            .orElse(Outcome.DISCARDED);
                });
    }

    // 에이전트가 배정을 거절했다(AI 명세 1.4). 질문을 내기 전인 면접만 방을 닫고 START_FAILED로 바꾼다.
    // 다시 시작(5.4)하기 전에 보낸 거절이 늦게 오면 새 시도를 실패시키지 않게 버린다.
    // 방은 행을 잠근 채 닫는다. 커밋 뒤에 닫으면 그 사이 다시 시작해 연 방을 지울 수 있다
    private Outcome assignmentRejected(long sessionId, AiResultMessage message) {
        String reason = required(message.reason(), "reason");
        if (!REJECT_REASONS.contains(reason)) {
            throw new InvalidAiResultException("배정 거절 이유가 아니다: " + reason);
        }
        OffsetDateTime occurredAt = required(message.occurredAt(), "occurredAt");
        LOG.warn("면접방 배정 거절: session={} reason={}", sessionId, reason);
        return transactions.execute(
                status -> {
                    InterviewSession session = lockInProgress(sessionId);
                    if (session == null
                            || occurredAt.isBefore(session.getStartedAt())
                            || questions
                                    .findFirstBySessionIdOrderBySeqDesc(sessionId)
                                    .isPresent()) {
                        return Outcome.DISCARDED;
                    }
                    session.failStart();
                    rooms.close(sessionId);
                    return Outcome.SAVED;
                });
    }

    // 결과 생성 중인 면접 행을 잠근다. 결과 생성 중이 아니거나 마지막으로 보낸 EVALUATE의 결과가 아니면 null
    private InterviewSession lockAnalyzing(long sessionId, String jobId) {
        return sessions.findByIdForUpdate(sessionId)
                .filter(session -> session.getStatus() == SessionStatus.ANALYZING)
                .filter(session -> isLatestEvaluate(sessionId, jobId))
                .orElse(null);
    }

    // 5.9로 다시 만들면 jobId가 바뀐다. 기록이 없으면(만료) 상태 조건만으로 거른다
    private boolean isLatestEvaluate(long sessionId, String jobId) {
        return runtimes.findEvaluateJobId(sessionId)
                .map(latest -> latest.toString().equals(jobId))
                .orElse(true);
    }

    private static List<CriterionScore> validScores(List<CriterionScore> scores) {
        if (!Criterion.coversAllOnce(scores.stream().map(CriterionScore::criterion).toList())) {
            throw new InvalidAiResultException("기준별 점수는 4개 기준에 하나씩이다");
        }
        for (CriterionScore score : scores) {
            validScore(score.score(), "sessionScores.score");
            if (score.comment() != null) {
                withinCommentLength(score.comment(), "sessionScores.comment");
            }
        }
        return scores;
    }

    private static void validate(EvaluatedAnswer answer) {
        required(answer.answerId(), "answers.answerId");
        validScore(answer.score(), "answers.score");
        required(answer.goodPoint(), "answers.goodPoint");
        required(answer.improvePoint(), "answers.improvePoint");
        required(answer.evaluation(), "answers.evaluation");
    }

    private static void validScore(Integer score, String field) {
        if (required(score, field) < 0 || score > 100) {
            throw new InvalidAiResultException(field + "는 0~100이다: " + score);
        }
    }

    // 없거나 비었으면(headline을 보내기 전 AI) null
    private static String headline(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        String stripped = text.strip();
        if (stripped.codePointCount(0, stripped.length()) <= MAX_HEADLINE_LENGTH) {
            return stripped;
        }
        return stripped.substring(0, stripped.offsetByCodePoints(0, MAX_HEADLINE_LENGTH)).strip();
    }

    private static String withinCommentLength(String text, String field) {
        if (text.codePointCount(0, text.length()) > MAX_COMMENT_LENGTH) {
            throw new InvalidAiResultException(field + "는 255자 이하다");
        }
        return text;
    }

    // 저장할 값(소수 둘째 자리)으로 맞춘다. 채팅이면 null
    private static SpeechMetrics validMetrics(SpeechMetrics metrics) {
        if (metrics == null) {
            return null;
        }
        Integer longPauseCount = metrics.longPauseCount();
        if (longPauseCount != null && longPauseCount < 0) {
            throw new InvalidAiResultException("longPauseCount는 0 이상이다: " + longPauseCount);
        }
        return new SpeechMetrics(
                metric(metrics.fillerPerMin(), "fillerPerMin"),
                longPauseCount,
                metric(metrics.speedDeviationPct(), "speedDeviationPct"),
                metric(metrics.trailingOffRatio(), "trailingOffRatio"),
                metric(metrics.pitchRangeSt(), "pitchRangeSt"));
    }

    // 소수 둘째 자리로 맞춘다. 컬럼에 들어가지 않는 값은 AI가 null로 보내기로 했다(AI 명세 4장)
    private static BigDecimal metric(BigDecimal value, String field) {
        if (value == null) {
            return null;
        }
        BigDecimal scaled = value.setScale(2, RoundingMode.HALF_UP);
        if (scaled.abs().compareTo(MAX_METRIC) > 0) {
            throw new InvalidAiResultException(field + "는 ±999.99 안이다: " + value);
        }
        return scaled;
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

    // 다시보기 타임라인용 값(AI 명세 3장 trailingOffAtMs·6.6 impressions)이 범위를 벗어나면 그 값만 버리고 답변은 저장한다.
    // 저장만 하고 채점·결과에 쓰지 않는 값이라 답변을 실패 목록으로 보낼 이유가 없다
    private static AnswerSpeech validTimeline(AnswerSpeech speech, long sessionId, int seq) {
        if (speech == null) {
            return null;
        }
        AnswerSpeech valid = speech.withValidTimeline();
        if (valid != speech) {
            LOG.warn("answer.completed 타임라인 값이 범위를 벗어나 버린다: session={} seq={}", sessionId, seq);
        }
        return valid;
    }

    // 끊긴 구간이 0 ≤ startMs ≤ endMs · 시각 순이 아니면 구간만 버린다. 답변은 저장하고 채점은 끊긴 구간 없이 한다(AI 명세 6.2)
    private static List<SttGap> validSttGaps(List<SttGap> gaps, long sessionId, int seq) {
        if (gaps == null) {
            return null;
        }
        boolean valid =
                gaps.size() <= MAX_TOKEN_COUNT
                        && gaps.stream()
                                .allMatch(
                                        g ->
                                                g != null
                                                        && g.startMs() >= 0
                                                        && g.startMs() <= g.endMs())
                        && IntStream.range(1, gaps.size())
                                .allMatch(i -> gaps.get(i - 1).startMs() <= gaps.get(i).startMs());
        if (!valid) {
            LOG.warn("answer.completed sttGaps 형식이 맞지 않아 버린다: session={} seq={}", sessionId, seq);
            return null;
        }
        return gaps.isEmpty() ? null : gaps;
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
