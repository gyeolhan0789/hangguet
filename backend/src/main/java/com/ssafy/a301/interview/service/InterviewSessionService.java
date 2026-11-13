package com.ssafy.a301.interview.service;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.domain.ApplicationClaim;
import com.ssafy.a301.application.repository.ApplicationClaimRepository;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.company.service.CompanyCardFinder;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import com.ssafy.a301.group.service.GroupEndService;
import com.ssafy.a301.group.service.GroupTurnService;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.QuestionResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionCreateRequest;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionGroup;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.mapper.InterviewMapper;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.user.repository.UserRepository;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 5.1~5.5 면접 만들기부터 시작까지(그룹 면접 참가자의 면접 만들기 포함), 5.8·5.9 끝내기·결과 재생성. 회원은 토큰의 회원 id로만 찾고, 없거나 남의 면접은
 * 404다. 플랜 생성 상태(Redis)는 작업이 큐로 나가기 전, 트랜잭션 안에서 기록한다. 커밋 뒤에 쓰면 작업자가 먼저 PLAN을 꺼내 GENERATING이 아니라며 버릴
 * 수 있다(BE 설계 5.1). 질문 보관함으로 바로 준비한 READY는 기다릴 작업이 없어 커밋 뒤에 기록한다.
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
    private final SessionRuntimeService runtimes;
    private final AiJobService aiJobs;
    private final TransactionTemplate transactions;
    private final InterviewRoom rooms;
    private final CompanyCardFinder companyCards;
    private final InterviewCapacity capacity;
    private final SessionEnder ender;
    private final GroupEndService groupEnds;
    private final GroupTurnService groupTurns;
    private final InterviewGroupRepository groups;
    private final ApplicationClaimRepository applicationClaims;
    private final QuestionPoolAssigner pools;
    private final QuestionPoolDiscarder discarder;

    public InterviewSessionService(
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            AnswerRepository answers,
            InterviewPlanRepository plans,
            ApplicationRepository applications,
            UserRepository users,
            SessionRuntimeService runtimes,
            AiJobService aiJobs,
            TransactionTemplate transactions,
            InterviewRoom rooms,
            CompanyCardFinder companyCards,
            InterviewCapacity capacity,
            SessionEnder ender,
            GroupEndService groupEnds,
            GroupTurnService groupTurns,
            InterviewGroupRepository groups,
            ApplicationClaimRepository applicationClaims,
            QuestionPoolAssigner pools,
            QuestionPoolDiscarder discarder) {
        this.sessions = sessions;
        this.questions = questions;
        this.answers = answers;
        this.plans = plans;
        this.applications = applications;
        this.users = users;
        this.runtimes = runtimes;
        this.aiJobs = aiJobs;
        this.transactions = transactions;
        this.rooms = rooms;
        this.companyCards = companyCards;
        this.capacity = capacity;
        this.ender = ender;
        this.groupEnds = groupEnds;
        this.groupTurns = groupTurns;
        this.groups = groups;
        this.applicationClaims = applicationClaims;
        this.pools = pools;
        this.discarder = discarder;
    }

    /**
     * 5.1. 지원서 행을 잠가 지원서 삭제(4.5)와 겹치지 않게 한다. 지운 지원서로는 만들지 않는다(404). 지원서 회사명으로 찾은 회사 카드를 면접에 남겨 질문
     * 생성(5.3 다시 만들기 포함)에 같은 카드를 쓴다(AI 명세 8장).
     */
    public SessionResponse create(long userId, SessionCreateRequest request) {
        OffsetDateTime now = OffsetDateTime.now(KoreaTime.ZONE);
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
                                            companyCards
                                                    .findCurrent(application.getCompanyName())
                                                    .orElse(null),
                                            request.persona(),
                                            request.mode()));
                    return InterviewMapper.toSessionResponse(
                            session, prepare(session, now), null, 0, now, null);
                });
    }

    /**
     * 그룹 면접 참가자의 면접을 만든다(API 명세 10.1 · 10.3). 5.1과 같이 지원서 행을 잠그고 회사 카드를 남긴 뒤 그룹용 플랜(질문 2개) 생성을
     * 시작한다. 그룹 행을 잠근 트랜잭션 안에서 부른다(잠금 순서: 회원 → 그룹 → 지원서 · 면접, docs/그룹면접-설계.md 9장).
     */
    public InterviewSession createForGroup(
            long userId,
            long applicationId,
            Persona persona,
            InterviewMode mode,
            long groupId,
            OffsetDateTime now) {
        Application application =
                applications
                        .findForUpdate(applicationId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.APPLICATION_NOT_FOUND));
        InterviewSession session =
                sessions.save(
                        InterviewSession.ofGroup(
                                users.getReferenceById(userId),
                                application,
                                companyCards.findCurrent(application.getCompanyName()).orElse(null),
                                persona,
                                mode,
                                groupId));
        startPlan(session, now);
        return session;
    }

    /**
     * 5.2. 결과 생성이 최대 대기 시간을 넘겼으면 FAILED로 바꿔 화면이 5.9로 다시 시도하게 한다(AI 명세 5장). 면접 행을 잠가 확인하므로 그 사이 작업자가
     * 결과를 저장했으면 그대로 둔다.
     */
    public SessionResponse get(long userId, long sessionId) {
        OffsetDateTime now = OffsetDateTime.now(KoreaTime.ZONE);
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
        OffsetDateTime now = OffsetDateTime.now(KoreaTime.ZONE);
        return transactions.execute(
                status -> {
                    InterviewSession session = lock(userId, sessionId);
                    if (runtimes.current(sessionId, now.toInstant()).planStatus()
                            != PlanStatus.FAILED) {
                        throw new ApiException(ErrorCode.PLAN_NOT_FAILED);
                    }
                    return InterviewMapper.toGroupSessionResponse(
                            session, prepare(session, now), null, 0, now, groupOf(session));
                });
    }

    /**
     * 5.4. 면접방을 열고(화상이면 녹화) 에이전트에 질문 5개를 배정한 뒤 입장 정보를 준다. 질문 행은 에이전트가 질문을 말할 때(question.started)
     * 생긴다(API 명세 5.4). 배정 거절(START_FAILED) 뒤에도 같은 플랜으로 다시 시작한다. 화상 면접이 동시 진행 상한에 닿았거나 면접방을 열지 못하면
     * 상태를 그대로 두고 503을 준다. 커밋하지 못하면 연 방을 지운다.
     */
    public SessionResponse start(long userId, long sessionId) {
        // 녹화 원본 위치는 시작 시각의 밀리초다(BE 설계 5.6). DB에 저장하며 마이크로초로 반올림돼도 밀리초가 바뀌지 않게 미리 자른다
        OffsetDateTime now = OffsetDateTime.now(KoreaTime.ZONE).truncatedTo(ChronoUnit.MILLIS);
        return transactions.execute(
                status -> {
                    InterviewSession session = lock(userId, sessionId);
                    // 그룹 면접은 방장이 그룹으로 시작한다(API 명세 10.10)
                    if (session.isGroup()) {
                        throw new ApiException(ErrorCode.GROUP_SESSION);
                    }
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
                    if (session.isVideo()) {
                        capacity.reserveVideo(now);
                    }
                    session.start(now);
                    rooms.open(
                            sessionId,
                            session.isVideo(),
                            assignment(session, plan),
                            session.getStartedAt());
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

    /**
     * 5.14. 새로고침·연결 끊김 뒤 면접방에 다시 들어갈 입장 정보. 그룹 면접은 그룹 면접방(group-{groupId})에 자기 참가자 이름으로 들어간다(API 명세
     * 10.10). 그룹 면접 참가자는 처음 입장도 이 API로 받는다(10.7 응답에는 방장 것만 있다).
     */
    public RoomResponse roomAccess(long userId, long sessionId) {
        InterviewSession session =
                sessions.findWithApplication(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.getStatus() != SessionStatus.IN_PROGRESS) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (session.isGroup()) {
            groupTurns.requireRejoinable(sessionId);
            return rooms.issueGroupAccess(session.getGroupId(), sessionId, session.isVideo());
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
                        .map(InterviewSessionService::assignedQuestion)
                        .toList());
        return assignment;
    }

    // 연결 회사 항목은 꼬리질문 생성의 입력이다. 연결하지 않은 질문은 null(AI 명세 6.1)
    private static Map<String, Object> assignedQuestion(PlanQuestion question) {
        Map<String, Object> assigned = new LinkedHashMap<>();
        assigned.put("seq", question.seq());
        assigned.put("content", question.content());
        assigned.put("criteria", question.criteria());
        assigned.put("companyItem", question.companyItem());
        return assigned;
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
     * 끝내기(5.8)를 부른다. 그룹 면접은 답하지 않았고 마감되지 않은 마지막 질문이고, 내 질문을 모두 마쳤으면 409다(API 명세 10.10).
     */
    public Optional<QuestionResponse> currentQuestion(long userId, long sessionId) {
        InterviewSession session =
                sessions.findByIdAndUserId(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.getStatus() != SessionStatus.IN_PROGRESS) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        if (session.isGroup()) {
            return groupTurns.currentQuestion(sessionId).map(InterviewMapper::toQuestionResponse);
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
     * 남긴다. 그룹 세션은 GroupEndService가 그룹 행부터 잠그고 끝낸다.
     */
    public SessionResponse end(long userId, long sessionId, BigDecimal gazeRatio) {
        InterviewSession found =
                sessions.findByIdAndUserId(sessionId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        // 그룹 세션은 내 면접만 끝내고 나머지는 계속한다(API 명세 10.10, 잠금 순서: 그룹 → 면접)
        if (found.isGroup()) {
            return groupEnds.endByUser(found.getGroupId(), sessionId, gazeRatio);
        }
        OffsetDateTime now = OffsetDateTime.now(KoreaTime.ZONE);
        SessionResponse response =
                transactions.execute(
                        status -> ender.end(lock(userId, sessionId), now, gazeRatio, null, true));
        // 커밋 뒤 면접방을 지운다. 에이전트가 나가고 화상이면 녹화도 끝난다
        rooms.close(sessionId);
        return response;
    }

    /** 5.9. 결과 생성이 실패한 면접만 다시 만든다. */
    public SessionResponse retryAnalysis(long userId, long sessionId) {
        OffsetDateTime now = OffsetDateTime.now(KoreaTime.ZONE);
        return transactions.execute(
                status -> {
                    InterviewSession session = lock(userId, sessionId);
                    session.retryAnalysis();
                    startAnalysis(sessionId, now);
                    return InterviewMapper.toGroupSessionResponse(
                            session,
                            runtimes.current(sessionId, now.toInstant()),
                            null,
                            answers.countByQuestionSessionId(sessionId),
                            now,
                            groupOf(session));
                });
    }

    private InterviewSession lock(long userId, long sessionId) {
        return sessions.findForUpdate(sessionId, userId)
                .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
    }

    // 5.1 · 5.3. 개인 면접은 회사 정보가 바뀐 보관함 질문을 버린 뒤, 사용하지 않은 질문이 5개 이상이면 바로 배정해 플랜을 저장하고
    // AI 작업을 요청하지 않는다(AI 명세 2장). 그 밖에는 질문 생성을 시작한다
    private SessionRuntime prepare(InterviewSession session, OffsetDateTime now) {
        if (!session.isGroup()) {
            discarder.discardOutdated(session, now.toLocalDate());
            Optional<InterviewPlan> assigned =
                    pools.assign(
                            session,
                            applicationClaims
                                    .findByApplicationIdOrderById(session.getApplication().getId())
                                    .stream()
                                    .map(ApplicationClaim::toPlanClaim)
                                    .toList());
            if (assigned.isPresent()) {
                plans.save(assigned.get());
                runtimes.markPlanReadyAfterCommit(session.getId());
                return SessionRuntime.ready();
            }
        }
        startPlan(session, now);
        return SessionRuntime.generating();
    }

    // 트랜잭션 안에서 부른다. 상태를 먼저 기록하고 작업을 Outbox에 넣는다.
    // 개인 면접은 지원서 주장이 있으면 질문 생성, 없으면 주장 추출을 요청한다. 주장을 저장하면 결과 처리가 이 면접의 질문 생성을 요청한다(AI 명세 2장).
    // 5.3은 지원서를 잠그지 않으므로 상태를 먼저 기록해야, 주장 저장과 겹쳐도 주장 저장이 이 면접을 주장을 기다리는 면접으로 찾는다
    private void startPlan(InterviewSession session, OffsetDateTime now) {
        runtimes.startPlan(session.getId(), now.toInstant());
        long applicationId = session.getApplication().getId();
        if (session.isGroup() || applicationClaims.existsByApplicationId(applicationId)) {
            aiJobs.enqueue(AiJob.plan(session.getId()));
            return;
        }
        aiJobs.enqueue(AiJob.extractClaims(applicationId));
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
        return InterviewMapper.toGroupSessionResponse(
                session,
                runtime,
                current,
                answers.countByQuestionSessionId(session.getId()),
                now,
                groupOf(session));
    }

    // 그룹 면접이면 그룹 id와 지금 그룹 상태(API 명세 10.10). 개인 면접은 null
    private SessionGroup groupOf(InterviewSession session) {
        if (!session.isGroup()) {
            return null;
        }
        return groups.findById(session.getGroupId())
                .map(group -> new SessionGroup(group.getId(), group.getStatus()))
                .orElseThrow(() -> new IllegalStateException("그룹이 없다: " + session.getGroupId()));
    }
}
