package com.ssafy.a301.interview.service;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.home.domain.Streak;
import com.ssafy.a301.home.repository.PracticeLogRepository;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.QuestionResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionCreateRequest;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.mapper.InterviewMapper;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 5.1~5.5 면접 만들기부터 시작까지, 5.8·5.9 끝내기·결과 재생성. 회원은 토큰의 회원 id로만 찾고, 없거나 남의 면접은 404다. 플랜 생성 상태(Redis)는
 * 작업이 큐로 나가기 전, 트랜잭션 안에서 기록한다. 커밋 뒤에 쓰면 작업자가 먼저 PLAN을 꺼내 GENERATING이 아니라며 버릴 수 있다(BE 설계 5.1).
 */
@Service
public class InterviewSessionService {
    // 연습한 날은 한국 시간 기준(BE 설계 1장)
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final AnswerRepository answers;
    private final InterviewPlanRepository plans;
    private final ApplicationRepository applications;
    private final UserRepository users;
    private final PracticeLogRepository practiceLogs;
    private final SessionRuntimeService runtimes;
    private final AiJobService aiJobs;
    private final TransactionTemplate transactions;

    public InterviewSessionService(
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            AnswerRepository answers,
            InterviewPlanRepository plans,
            ApplicationRepository applications,
            UserRepository users,
            PracticeLogRepository practiceLogs,
            SessionRuntimeService runtimes,
            AiJobService aiJobs,
            TransactionTemplate transactions) {
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.plans = plans;
        this.applications = applications;
        this.users = users;
        this.practiceLogs = practiceLogs;
        this.runtimes = runtimes;
        this.aiJobs = aiJobs;
        this.transactions = transactions;
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
        if (session.getStatus() == SessionStatus.ANALYZING
                && runtimes.isAnalysisTimedOut(sessionId, now.toInstant())) {
            session = transactions.execute(status -> failAnalysis(userId, sessionId));
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

    /** 5.4. 플랜의 1번 질문을 이 시점에 낸다(created_at이 다시보기 마커 기준). */
    public SessionResponse start(long userId, long sessionId) {
        OffsetDateTime now = OffsetDateTime.now();
        return transactions.execute(
                status -> {
                    InterviewSession session = lock(userId, sessionId);
                    if (session.getStatus() != SessionStatus.READY) {
                        throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
                    }
                    SessionRuntime runtime = runtimes.current(sessionId, now.toInstant());
                    if (runtime.planStatus() != PlanStatus.READY) {
                        throw new ApiException(ErrorCode.PLAN_NOT_READY);
                    }
                    PlanQuestion first =
                            plans.findById(sessionId)
                                    .flatMap(plan -> plan.question(1))
                                    .orElseThrow(
                                            () ->
                                                    new IllegalStateException(
                                                            "플랜에 1번 질문이 없다: " + sessionId));
                    session.start(now);
                    InterviewQuestion question =
                            questions.save(new InterviewQuestion(session, 1, first.content()));
                    return InterviewMapper.toSessionResponse(
                            session, runtime, question, 0, now, null);
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
     * 때만 true다(BE 설계 6.1). 답변이 없으면 결과·연습 인정 없이 ABORTED다.
     */
    public SessionResponse end(long userId, long sessionId) {
        OffsetDateTime now = OffsetDateTime.now();
        return transactions.execute(
                status -> {
                    InterviewSession session = lock(userId, sessionId);
                    int answeredCount = answers.countByQuestionSessionId(sessionId);
                    boolean practiced = session.end(now, answeredCount);
                    boolean leveledUp = false;
                    if (practiced) {
                        leveledUp =
                                recordPractice(
                                        userId,
                                        session.getStartedAt().atZoneSameInstant(KST).toLocalDate(),
                                        now.atZoneSameInstant(KST).toLocalDate());
                        startAnalysis(sessionId, now);
                        if (session.isVideo()) {
                            // 녹화 트랙 합치기(AI 명세 7장). 결과 생성과 따로 돌고 5.9에서는 다시 하지 않는다
                            aiJobs.enqueue(AiJob.mergeRecording(sessionId));
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

    private InterviewSession failAnalysis(long userId, long sessionId) {
        InterviewSession session = lock(userId, sessionId);
        if (session.getStatus() == SessionStatus.ANALYZING) {
            session.failAnalysis();
        }
        return session;
    }

    // 그날 처음일 때만 남긴다. 이번에 남겨 뱃지 구간이 바뀌었으면 true
    private boolean recordPractice(long userId, LocalDate practiceDate, LocalDate today) {
        List<LocalDate> before = practiceLogs.findPracticeDatesByUserId(userId);
        if (practiceLogs.insertIfAbsent(userId, practiceDate) == 0) {
            return false;
        }
        List<LocalDate> after = new ArrayList<>(before);
        after.add(practiceDate);
        return Streak.badgeLevel(Streak.current(before, today))
                != Streak.badgeLevel(Streak.current(after, today));
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
