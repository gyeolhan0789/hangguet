package com.ssafy.a301.interview.service;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.domain.ApplicationClaim;
import com.ssafy.a301.application.repository.ApplicationClaimRepository;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.AnswerSpeech;
import com.ssafy.a301.interview.domain.AnswerToken;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanClaim;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.QuestionPoolItem;
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
import com.ssafy.a301.interview.repository.QuestionPoolItemRepository;
import com.ssafy.a301.interview.repository.RecordingRepository;
import com.ssafy.a301.interview.repository.SessionRuntimeStore;
import com.ssafy.a301.interview.repository.SessionScoreRepository;
import com.ssafy.a301.interview.repository.SpeechMetricRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.service.TrackRecordingCheck.FirstQuestionStarted;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
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
    private static final String JOB_ID = "jobId";
    // 총평·기준 코멘트(VARCHAR(255), 글자 수)
    private static final int MAX_COMMENT_LENGTH = 255;
    // interview_sessions.headline 길이. AI가 30자를 넘기면 자르지만(AI 명세 4장) 저장이 실패하지 않게 BE도 자른다
    private static final int MAX_HEADLINE_LENGTH = 30;
    // 말하기 지표 컬럼 NUMERIC(5, 2)
    private static final BigDecimal MAX_METRIC = new BigDecimal("999.99");
    // 배정 거절 이유(AI 명세 1.4). 이유로 처리를 나누지는 않지만 모르는 값은 실패 목록으로 보낸다
    private static final Set<String> REJECT_REASONS = Set.of("INVALID_ASSIGNMENT");
    // 면접의 첫 질문 순서(AI 명세 2장)
    private static final int FIRST_SEQ = 1;
    // 꼬리질문 없이 플랜 질문을 그대로 출제하는 자리(AI 명세 2장 질문 출제)
    private static final Set<Integer> ALWAYS_PLANNED_SEQS = Set.of(1, 3);
    private static final String CLAIMS_EXTRACTED = "claims.extracted";
    private static final String CLAIMS_EXTRACT_FAILED = "claims.extractFailed";
    // 주장 종류(AI 명세 2장)
    private static final Set<String> CLAIM_TYPES = Set.of("EXPERIENCE", "NUMBER");
    // application_claims.claim_id 길이
    private static final int MAX_CLAIM_ID_LENGTH = 50;

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
    private final ApplicationEventPublisher events;
    private final SessionEnder ender;
    private final TransactionTemplate transactions;
    private final ApplicationRepository applications;
    private final ApplicationClaimRepository applicationClaims;
    private final QuestionPoolItemRepository poolItems;
    private final SessionRuntimeService runtimeService;
    private final QuestionPoolAssigner pools;
    private final QuestionPoolDiscarder discarder;

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
            ApplicationEventPublisher events,
            SessionEnder ender,
            TransactionTemplate transactions,
            ApplicationRepository applications,
            ApplicationClaimRepository applicationClaims,
            QuestionPoolItemRepository poolItems,
            SessionRuntimeService runtimeService,
            QuestionPoolAssigner pools,
            QuestionPoolDiscarder discarder) {
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
        this.events = events;
        this.ender = ender;
        this.transactions = transactions;
        this.applications = applications;
        this.applicationClaims = applicationClaims;
        this.poolItems = poolItems;
        this.runtimeService = runtimeService;
        this.pools = pools;
        this.discarder = discarder;
    }

    /**
     * @throws InvalidAiResultException 다시 처리해도 저장할 수 없는 메시지
     */
    public Outcome handle(String raw) {
        AiResultMessage message = parse(raw);
        String type = required(message.type(), "type");
        // 주장 추출은 면접이 아니라 지원서 단위 작업이라 sessionId 대신 applicationId를 담는다(AI 명세 1.3)
        if (type.equals(CLAIMS_EXTRACTED) || type.equals(CLAIMS_EXTRACT_FAILED)) {
            long applicationId = required(message.applicationId(), "applicationId");
            Outcome outcome =
                    type.equals(CLAIMS_EXTRACTED)
                            ? claimsExtracted(applicationId, message)
                            : claimsExtractFailed(applicationId);
            if (outcome == Outcome.DISCARDED) {
                LOG.info("AI 결과를 버렸다: {} application={}", type, applicationId);
            }
            return outcome;
        }
        long sessionId = required(message.sessionId(), "sessionId");
        Outcome outcome =
                switch (type) {
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
                    case "room.closed" -> roomClosed(sessionId, message);
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
        List<PlanClaim> claims = required(message.claims(), "claims");
        String promptVersion = required(message.promptVersion(), "promptVersion");
        String modelVersion = required(message.modelVersion(), "modelVersion");
        transactions.executeWithoutResult(
                status -> {
                    // 그룹 면접은 개인 맞춤 질문을 매번 만들고 예비 질문이 없어 받은 질문 그대로 저장한다(AI 명세 2장 질문 보관함)
                    if (session.isGroup()) {
                        plans.save(
                                new InterviewPlan(
                                        sessionId,
                                        claims,
                                        planQuestions,
                                        promptVersion,
                                        modelVersion));
                        return;
                    }
                    // 개인 면접은 프롬프트 버전이 다른 보관함 질문을 버리고, 받은 질문을 보관함에 넣은 뒤 보관함에서 배정한 질문 5개로 저장한다.
                    // 플랜과 같은 트랜잭션이라 같은 결과가 두 번 와도 한 번만 들어간다. 주장은 입력으로 보낸 지원서 주장 그대로 돌아온다(AI 명세 2장)
                    discarder.discardOtherVersions(session, promptVersion);
                    savePoolItems(session, planQuestions, promptVersion, modelVersion);
                    plans.save(
                            pools.assign(session, claims)
                                    .orElseThrow(
                                            () ->
                                                    new IllegalStateException(
                                                            "보관함에 넣은 질문을 배정하지 못했다: " + sessionId)));
                });
        runtimes.markPlanReady(sessionId);
        return Outcome.SAVED;
    }

    // 저장 순서가 배정 순서이므로 seq 순으로 넣는다(AI 명세 2장 출제 자리 배정)
    private void savePoolItems(
            InterviewSession session,
            List<PlanQuestion> planQuestions,
            String promptVersion,
            String modelVersion) {
        Application application = applications.getReferenceById(session.getApplication().getId());
        poolItems.saveAll(
                planQuestions.stream()
                        .sorted(Comparator.comparingInt(PlanQuestion::seq))
                        .map(
                                question ->
                                        new QuestionPoolItem(
                                                application,
                                                session.getPersona(),
                                                question,
                                                promptVersion,
                                                modelVersion))
                        .toList());
    }

    /**
     * 지원서 주장(AI 명세 1.4 claims.extracted). 지원서 행을 잠가 주장을 확인하는 면접 만들기(5.1)와 겹치지 않게 하고, 주장이 이미 있으면(같은
     * 작업의 중복, 5.1 · 5.3이 다시 요청한 추출) 버린다. 저장하면 그 지원서에서 주장을 기다리던 면접의 질문 생성을 요청한다.
     */
    private Outcome claimsExtracted(long applicationId, AiResultMessage message) {
        List<PlanClaim> claims = validClaims(required(message.claims(), "claims"), applicationId);
        String promptVersion = required(message.promptVersion(), "promptVersion");
        String modelVersion = required(message.modelVersion(), "modelVersion");
        OffsetDateTime now = OffsetDateTime.now(KoreaTime.ZONE);
        return transactions.execute(
                status -> {
                    Application application =
                            applications.findByIdForUpdate(applicationId).orElse(null);
                    if (application == null
                            || applicationClaims.existsByApplicationId(applicationId)) {
                        return Outcome.DISCARDED;
                    }
                    applicationClaims.saveAll(
                            claims.stream()
                                    .map(
                                            claim ->
                                                    new ApplicationClaim(
                                                            application,
                                                            claim,
                                                            promptVersion,
                                                            modelVersion))
                                    .toList());
                    for (long sessionId : waitingForClaims(applicationId)) {
                        // AI가 질문 생성 작업의 requestedAt부터 최대 대기 시간을 세므로 시작 시각을 다시 기록한다(BE 설계 5.1)
                        runtimeService.startPlan(sessionId, now.toInstant());
                        aiJobs.enqueue(AiJob.plan(sessionId));
                    }
                    return Outcome.SAVED;
                });
    }

    // 주장을 추출하지 못했다(AI 명세 1.4 claims.extractFailed). 주장을 기다리던 면접을 실패로 바꿔 화면이 다시 만들기(5.3)로 넘어가게 한다
    private Outcome claimsExtractFailed(long applicationId) {
        return transactions.execute(
                status -> {
                    if (applications.findByIdForUpdate(applicationId).isEmpty()
                            || applicationClaims.existsByApplicationId(applicationId)) {
                        return Outcome.DISCARDED;
                    }
                    List<Long> waiting = waitingForClaims(applicationId);
                    waiting.forEach(runtimes::failPlanIfGenerating);
                    return waiting.isEmpty() ? Outcome.DISCARDED : Outcome.SAVED;
                });
    }

    // 주장이 없는 지원서로 만든 개인 면접은 질문 생성 대신 주장 추출을 요청하므로, 플랜이 없고 플랜을 만드는 중인 면접이 주장을 기다리는 면접이다
    private List<Long> waitingForClaims(long applicationId) {
        return sessions.findPersonalIdsWithoutPlan(applicationId).stream()
                .filter(this::isPlanGenerating)
                .toList();
    }

    // 질문 생성에 그대로 넣으므로 AI가 작업에서 확인하는 칸(AI 명세 2장)과 저장 컬럼 길이를 확인한다
    private static List<PlanClaim> validClaims(List<PlanClaim> claims, long applicationId) {
        if (claims.isEmpty()) {
            throw new InvalidAiResultException("주장이 없다: application=" + applicationId);
        }
        Set<String> ids = new HashSet<>();
        for (PlanClaim claim : claims) {
            boolean valid =
                    claim != null
                            && !isBlank(claim.id())
                            && claim.id().length() <= MAX_CLAIM_ID_LENGTH
                            && ids.add(claim.id())
                            && !isBlank(claim.text())
                            && CLAIM_TYPES.contains(claim.type())
                            && claim.sentenceNo() != null
                            && claim.sentenceNo() >= 1;
            if (!valid) {
                throw new InvalidAiResultException("주장 형식이 틀렸다: application=" + applicationId);
            }
        }
        return claims;
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
                    // 시작 시각보다 이른 질문은 시작 실패(AI 명세 6.5) 뒤 다시 시작하기 전 시도의 것이다(AI 명세 1.4).
                    // 그룹 면접의 질문은 그룹 결과 큐(ai:results:group)로만 받는다(그룹 행부터 잠그고 차례를 확인해야 한다)
                    if (session == null
                            || session.isGroup()
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
                    markPoolItemUsed(sessionId, seq, message.promptVersion(), startedAt);
                    // 첫 질문 때는 트랙이 올라와 있으므로 녹화가 모두 시작됐는지 확인한다
                    if (seq == FIRST_SEQ && session.isVideo()) {
                        events.publishEvent(
                                new FirstQuestionStarted(sessionId, session.getStartedAt()));
                    }
                    return Outcome.SAVED;
                });
    }

    // 출제한 질문이 보관함 질문이면 다시 배정하지 않게 사용 처리한다. 1·3번은 항상 플랜 질문이고, 2·4·5번은 꼬리질문 대신 예비 질문을
    // 출제했을 때(promptVersion이 null)만 플랜 질문이다. 보관함에서 배정하지 않은 플랜이거나 그 사이 폐기한 질문이면 그대로 둔다(AI 명세 2장)
    private void markPoolItemUsed(
            long sessionId, int seq, String promptVersion, OffsetDateTime startedAt) {
        if (!ALWAYS_PLANNED_SEQS.contains(seq) && promptVersion != null) {
            return;
        }
        plans.findById(sessionId)
                .flatMap(plan -> plan.question(seq))
                .map(PlanQuestion::poolItemId)
                .flatMap(poolItems::findById)
                .ifPresent(item -> item.markUsed(startedAt));
    }

    // 화상 답변. 질문 하나에 답변 하나이며(5.7과 같은 규칙), 저장하면 채점 작업을 넣는다
    private Outcome answerCompleted(long sessionId, AiResultMessage message) {
        int seq = requiredSeq(message);
        String content = message.content();
        List<AnswerToken> tokens = message.tokens();
        VoiceAnswerChecks.requireValid(content, tokens, sessionId, seq);
        OffsetDateTime answerStartedAt = required(message.answerStartedAt(), "answerStartedAt");
        AnswerSpeech speech = VoiceAnswerChecks.validTimeline(message.speech(), sessionId, seq);
        List<SttGap> sttGaps = VoiceAnswerChecks.validSttGaps(message.sttGaps(), sessionId, seq);
        return transactions.execute(
                status -> {
                    InterviewSession session = lockInProgress(sessionId);
                    // 그룹 면접의 답변은 그룹 결과 큐(ai:results:group)로만 받는다
                    if (session == null || !session.isVideo() || session.isGroup()) {
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
        String jobId = required(message.jobId(), JOB_ID);
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
        String jobId = required(message.jobId(), JOB_ID);
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
        String jobId = required(message.jobId(), JOB_ID);
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
                    Recording recording =
                            recordings.findByObjectKeyForUpdate(objectKey).orElse(null);
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
    // 이미 READY이거나 행이 없으면(V10 이전에 끝남) 버린다. 행이 없는 면접은 6.4가 종료 시각으로 판단한다.
    // 다시 합치기(6.5) 전에 넣은 작업의 실패가 늦게 오면 진행 중인 새 시도를 실패로 덮지 않게 버린다
    private Outcome recordingMergeFailed(long sessionId, AiResultMessage message) {
        LOG.warn("녹화 합치기 실패: session={} reason={}", sessionId, message.reason());
        return transactions.execute(
                status -> {
                    InterviewSession session = sessions.findById(sessionId).orElse(null);
                    if (session == null || !session.isVideo()) {
                        return Outcome.DISCARDED;
                    }
                    return recordings
                            .findByObjectKeyForUpdate(Recording.sessionVideoKey(sessionId))
                            .filter(recording -> recording.markMergeFailed(message.jobId()))
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

    // 지원자가 모두 떠나 LiveKit이 면접방을 닫았다(AI 명세 1.4 · 6.5). 끝내기(5.8) 없이 떠난 개인 면접을 5.8과 같이 끝낸다.
    // 답변이 있으면 결과를 만들고 없으면 ABORTED다. 화면이 재던 시선 비율은 받지 못했으므로 비운다.
    // 다시 시작(5.4)하기 전 방이 닫힌 것이 늦게 오면 새 시도를 끝내지 않게 버린다. 그룹 면접은 그룹 정리가 끝낸다
    private Outcome roomClosed(long sessionId, AiResultMessage message) {
        OffsetDateTime occurredAt = required(message.occurredAt(), "occurredAt");
        return transactions.execute(
                status -> {
                    InterviewSession session = lockInProgress(sessionId);
                    if (session == null
                            || session.isGroup()
                            || occurredAt.isBefore(session.getStartedAt())) {
                        return Outcome.DISCARDED;
                    }
                    LOG.info("면접방이 닫혀 면접을 끝낸다: session={}", sessionId);
                    ender.end(session, OffsetDateTime.now(KoreaTime.ZONE), null, null, true);
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
