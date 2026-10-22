package com.ssafy.a301.interview.service;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
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
import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 5.1~5.5 면접 만들기부터 시작까지. 회원은 토큰의 회원 id로만 찾고, 없거나 남의 면접은 404다. 플랜 생성 상태(Redis)는 작업이 큐로 나가기 전, 트랜잭션
 * 안에서 기록한다. 커밋 뒤에 쓰면 작업자가 먼저 PLAN을 꺼내 GENERATING이 아니라며 버릴 수 있다(BE 설계 5.1).
 */
@Service
public class InterviewSessionService {
    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final AnswerRepository answers;
    private final InterviewPlanRepository plans;
    private final ApplicationRepository applications;
    private final UserRepository users;
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
            SessionRuntimeService runtimes,
            AiJobService aiJobs,
            TransactionTemplate transactions) {
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.plans = plans;
        this.applications = applications;
        this.users = users;
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

    /** 5.2 */
    public SessionResponse get(long userId, long sessionId) {
        OffsetDateTime now = OffsetDateTime.now();
        InterviewSession session =
                sessions.findWithApplication(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
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

    private InterviewSession lock(long userId, long sessionId) {
        return sessions.findForUpdate(sessionId, userId)
                .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
    }

    // 트랜잭션 안에서 부른다. 상태를 먼저 기록하고 작업을 Outbox에 넣는다
    private void startPlan(long sessionId, OffsetDateTime now) {
        runtimes.startPlan(sessionId, now.toInstant());
        aiJobs.enqueue(AiJob.plan(sessionId));
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
