package com.ssafy.a301.interview.service;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.interview.dto.InterviewDtos.QuestionResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionCreateRequest;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.mapper.InterviewMapper;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.repository.RecordingRepository;
import com.ssafy.a301.interview.repository.SpeechMetricRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.practice.service.PracticeService;
import com.ssafy.a301.user.repository.UserRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 5.1~5.5 면접 만들기부터 시작까지, 5.8·5.9 끝내기·결과 재생성. 회원은 토큰의 회원 id로만 찾고, 없거나 남의 면접은 404다. 플랜 생성 상태(Redis)는
 * 작업이 큐로 나가기 전, 트랜잭션 안에서 기록한다. 커밋 뒤에 쓰면 작업자가 먼저 PLAN을 꺼내 GENERATING이 아니라며 버릴 수 있다(BE 설계 5.1).
 */
@Service
public class InterviewSessionService {
    // 연습한 날은 한국 시간 기준(BE 설계 1장)

    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final AnswerRepository answers;
    private final InterviewPlanRepository plans;
    private final ApplicationRepository applications;
    private final UserRepository users;
    private final PracticeService practices;
    private final SessionRuntimeService runtimes;
    private final AiJobService aiJobs;
    private final TransactionTemplate transactions;
    private final InterviewRoom rooms;
    private final RecordingRepository recordings;
    private final SpeechMetricRepository speechMetrics;

    public InterviewSessionService(
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            AnswerRepository answers,
            InterviewPlanRepository plans,
            ApplicationRepository applications,
            UserRepository users,
            PracticeService practices,
            SessionRuntimeService runtimes,
            AiJobService aiJobs,
            TransactionTemplate transactions,
            InterviewRoom rooms,
            RecordingRepository recordings,
            SpeechMetricRepository speechMetrics) {
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.plans = plans;
        this.applications = applications;
        this.users = users;
        this.practices = practices;
        this.runtimes = runtimes;
        this.aiJobs = aiJobs;
        this.transactions = transactions;
        this.rooms = rooms;
        this.recordings = recordings;
        this.speechMetrics = speechMetrics;
    }

    /** 5.1. 지원서 행을 잠가 지원서 수정·삭제(4.4·4.5)의 "사용 중" 확인과 겹치지 않게 한다. */
    public SessionResponse create(long userId, SessionCreateRequest request) {
        OffsetDateTime now = OffsetDateTime.now();
        return transactions.execute(
                status -> {
                    Application application =
                            applications
                                    .findForUpdate(request.applicationId(), userId)
                                    .orElseThrow(
                                            () ->
                                                    new ApiException(
                                                            ErrorCode.APPLICATION_NOT_FOUND));
                    InterviewSession session =
                            sessions.save(
                                    new InterviewSession(
                                            users.getReferenceById(userId),
                                            application,
                                            request.persona(),
                                            request.mode()));
                    startPlan(session.getId(), now);
                    return InterviewMapper.toSessionResponse(
                            session, SessionRuntime.generating(), null, 0, now, null);
                });
    }

    /**
     * 5.2. 결과 생성이 최대 대기 시간을 넘겼으면 FAILED로 바꿔 화면이 5.9로 다시 시도하게 한다(AI 명세 5장). 면접 행을 잠가 확인하므로 그 사이 작업자가
     * 결과를 저장했으면 그대로 둔다.
     */
    public SessionResponse get(long userId, long sessionId) {
        OffsetDateTime now = OffsetDateTime.now();
        InterviewSession session =
                sessions.findWithApplication(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.getStatus() == SessionStatus.ANALYZING && isAnalysisTimedOut(session, now)) {
            session = transactions.execute(status -> failAnalysis(userId, sessionId, now));
        }
        return toResponse(session, runtimes.current(sessionId, now.toInstant()), now);
    }

    /** 5.3. 플랜 생성이 실패했을 때만 다시 만든다. */
    public SessionResponse retryPlan(long userId, long sessionId) {
        OffsetDateTime now = OffsetDateTime.now();
        return transactions.execute(
                status -> {
                    InterviewSession session = lock(userId, sessionId);
                    if (runtimes.current(sessionId, now.toInstant()).planStatus()
                            != PlanStatus.FAILED) {
                        throw new ApiException(ErrorCode.PLAN_NOT_FAILED);
                    }
                    startPlan(sessionId, now);
                    return InterviewMapper.toSessionResponse(
                            session, SessionRuntime.generating(), null, 0, now, null);
                });
    }

    /**
     * 5.4. 면접방을 열고(화상이면 녹화) 에이전트에 질문 5개를 배정한 뒤 입장 정보를 준다. 질문 행은 에이전트가 질문을 말할 때(question.started)
     * 생긴다(API 명세 5.4). 배정 거절(START_FAILED) 뒤에도 같은 플랜으로 다시 시작한다. 면접방을 열지 못하면 상태를 그대로 두고 503을 준다.
     * 커밋하지 못하면 연 방을 지운다.
     */
    public SessionResponse start(long userId, long sessionId) {
        OffsetDateTime now = OffsetDateTime.now();
        return transactions.execute(
                status -> {
                    InterviewSession session = lock(userId, sessionId);
                    if (!session.canStart()) {
                        throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
                    }
                    SessionRuntime runtime = runtimes.current(sessionId, now.toInstant());
                    if (runtime.planStatus() != PlanStatus.READY) {
                        throw new ApiException(ErrorCode.PLAN_NOT_READY);
                    }
                    InterviewPlan plan =
                            plans.findById(sessionId)
                                    .orElseThrow(
                                            () ->
                                                    new IllegalStateException(
                                                            "플랜이 없다: " + sessionId));
                    session.start(now);
                    rooms.open(sessionId, session.isVideo(), assignment(session, plan));
                    closeRoomOnRollback(sessionId);
                    return InterviewMapper.toSessionResponse(
                            session,
                            runtime,
                            null,
                            0,
                            now,
                            null,
                            rooms.issueAccess(sessionId, session.isVideo()));
                });
    }

    /** 5.14. 새로고침·연결 끊김 뒤 면접방에 다시 들어갈 입장 정보 */
    public RoomResponse roomAccess(long userId, long sessionId) {
        InterviewSession session =
                sessions.findWithApplication(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.getStatus() != SessionStatus.IN_PROGRESS) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        return rooms.issueAccess(sessionId, session.isVideo());
    }

    // 에이전트 배정 정보(AI 명세 6.1). 에이전트는 DB를 읽지 않으므로 질문 글과 채점 기준을 담는다
    private static Map<String, Object> assignment(InterviewSession session, InterviewPlan plan) {
        Map<String, Object> assignment = new LinkedHashMap<>();
        assignment.put("sessionId", session.getId());
        assignment.put("mode", session.getMode().name());
        assignment.put("persona", session.getPersona().name());
        assignment.put("currentSeq", 1);
        assignment.put(
                "questions",
                plan.getQuestions().stream()
                        .sorted(Comparator.comparingInt(PlanQuestion::seq))
                        .map(
                                question ->
                                        Map.of(
                                                "seq", question.seq(),
                                                "content", question.content(),
                                                "criteria", question.criteria()))
                        .toList());
        return assignment;
    }

    // 면접방을 연 뒤 커밋하지 못하면(롤백) 방을 지운다. 에이전트·녹화가 혼자 남지 않게 한다
    private void closeRoomOnRollback(long sessionId) {
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED) {
                            rooms.close(sessionId);
                        }
                    }
                });
    }

    /**
     * 5.5. 답하지 않은 마지막 질문을 준다. 다음 질문을 만드는 중이면 비어 있다(202). 5개에 모두 답했으면 더 낼 질문이 없으므로 409이며, 화면은
     * 끝내기(5.8)를 부른다.
     */
    public Optional<QuestionResponse> currentQuestion(long userId, long sessionId) {
        InterviewSession session =
                sessions.findByIdAndUserId(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.getStatus() != SessionStatus.IN_PROGRESS) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        Optional<InterviewQuestion> last = questions.findFirstBySessionIdOrderBySeqDesc(sessionId);
        if (last.isPresent() && !answers.existsByQuestionId(last.get().getId())) {
            return last.map(InterviewMapper::toQuestionResponse);
        }
        if (last.isPresent() && last.get().getSeq() >= InterviewPlan.QUESTION_COUNT) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        return Optional.empty();
    }

    /**
     * 5.8. 답변이 있으면 결과 생성을 시작하고 시작일(한국 시간)에 처음이면 연습 기록을 남긴다. leveledUp은 이번에 기록이 남아 스트릭 뱃지 구간이 바뀌었을
     * 때만 true다(BE 설계 6.1). 답변이 없으면 결과·연습 인정 없이 ABORTED다. gazeRatio(화면이 잰 시선 비율)는 결과가 나오는 화상 면접일 때만
     * 남긴다.
     */
    public SessionResponse end(long userId, long sessionId, BigDecimal gazeRatio) {
        OffsetDateTime now = OffsetDateTime.now();
        SessionResponse response = endInTransaction(userId, sessionId, now, gazeRatio);
        // 커밋 뒤 면접방을 지운다. 에이전트가 나가고 화상이면 녹화도 끝난다
        rooms.close(sessionId);
        return response;
    }

    private SessionResponse endInTransaction(
            long userId, long sessionId, OffsetDateTime now, BigDecimal gazeRatio) {
        return transactions.execute(
                status -> {
                    InterviewSession session = lock(userId, sessionId);
                    int answeredCount = answers.countByQuestionSessionId(sessionId);
                    boolean practiced = session.end(now, answeredCount);
                    boolean leveledUp = false;
                    if (practiced) {
                        leveledUp =
                                practices.recordAndCheckLevelUp(
                                        userId,
                                        KoreaTime.dateOf(session.getStartedAt()),
                                        KoreaTime.dateOf(now));
                        startAnalysis(sessionId, now);
                        if (session.isVideo()) {
                            // 녹화 트랙 합치기(AI 명세 7장). 결과 생성과 따로 돌고 5.9에서는 다시 하지 않는다.
                            // 다시보기(6.4)가 합치는 중과 실패를 구분하도록 합친 녹화 행을 MERGING으로 먼저 만든다
                            aiJobs.enqueue(AiJob.mergeRecording(sessionId));
                            recordings.save(Recording.mergingSessionVideo(session));
                            if (gazeRatio != null) {
                                // 말하기 지표는 결과가 나올 때 채운다(AiResultService)
                                SpeechMetric metric =
                                        new SpeechMetric(session, null, null, null, null, null);
                                metric.recordGazeRatio(gazeRatio.setScale(2, RoundingMode.HALF_UP));
                                speechMetrics.save(metric);
                            }
                        }
                    }
                    return InterviewMapper.toSessionResponse(
                            session,
                            runtimes.current(sessionId, now.toInstant()),
                            null,
                            answeredCount,
                            now,
                            leveledUp);
                });
    }

    /** 5.9. 결과 생성이 실패한 면접만 다시 만든다. */
    public SessionResponse retryAnalysis(long userId, long sessionId) {
        OffsetDateTime now = OffsetDateTime.now();
        return transactions.execute(
                status -> {
                    InterviewSession session = lock(userId, sessionId);
                    session.retryAnalysis();
                    startAnalysis(sessionId, now);
                    return InterviewMapper.toSessionResponse(
                            session,
                            runtimes.current(sessionId, now.toInstant()),
                            null,
                            answers.countByQuestionSessionId(sessionId),
                            now,
                            null);
                });
    }

    private InterviewSession lock(long userId, long sessionId) {
        return sessions.findForUpdate(sessionId, userId)
                .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
    }

    // 트랜잭션 안에서 부른다. 상태를 먼저 기록하고 작업을 Outbox에 넣는다
    private void startPlan(long sessionId, OffsetDateTime now) {
        runtimes.startPlan(sessionId, now.toInstant());
        aiJobs.enqueue(AiJob.plan(sessionId));
    }

    // 트랜잭션 안에서 부른다. 작업을 Outbox에 넣고 그 jobId와 함께 상태를 기록한다(작업은 커밋 뒤에 보내므로 결과가 먼저 오지 않는다)
    private void startAnalysis(long sessionId, OffsetDateTime now) {
        AiJob job = aiJobs.enqueue(AiJob.evaluate(sessionId));
        runtimes.startAnalysis(sessionId, now.toInstant(), job.getId());
    }

    // 잠근 뒤 다시 확인한다. 잠금을 기다리는 사이 다른 요청이 FAILED로 바꾸고 5.9로 다시 시작했으면 새 시도를 실패시키지 않는다
    private InterviewSession failAnalysis(long userId, long sessionId, OffsetDateTime now) {
        InterviewSession session = lock(userId, sessionId);
        if (session.getStatus() == SessionStatus.ANALYZING && isAnalysisTimedOut(session, now)) {
            session.failAnalysis();
        }
        return session;
    }

    private boolean isAnalysisTimedOut(InterviewSession session, OffsetDateTime now) {
        return runtimes.isAnalysisTimedOut(
                session.getId(),
                session.getEndedAt() == null ? null : session.getEndedAt().toInstant(),
                now.toInstant());
    }

    private SessionResponse toResponse(
            InterviewSession session, SessionRuntime runtime, OffsetDateTime now) {
        InterviewQuestion last =
                questions.findFirstBySessionIdOrderBySeqDesc(session.getId()).orElse(null);
        InterviewQuestion current =
                last != null && !answers.existsByQuestionId(last.getId()) ? last : null;
        return InterviewMapper.toSessionResponse(
                session,
                runtime,
                current,
                answers.countByQuestionSessionId(session.getId()),
                now,
                null);
    }
}
