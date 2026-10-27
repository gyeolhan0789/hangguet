package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.SessionRuntimeStore;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 진행 중 면접 상태를 읽고 시작 단계를 기록한다. Redis에 planStatus가 없으면 플랜이 저장됐는지로 정한다(AI 명세 1.2). 시작 단계는 작업을 Outbox에
 * 넣는 트랜잭션 안에서 기록하므로(작업자가 먼저 결과를 보내지 않게), 그 트랜잭션이 되돌려지면 기록도 되돌린다.
 */
@Service
public class SessionRuntimeService {
    private static final Logger LOG = LoggerFactory.getLogger(SessionRuntimeService.class);
    private final SessionRuntimeStore store;
    private final InterviewPlanRepository plans;
    private final Duration planTimeout;
    private final Duration analysisTimeout;

    public SessionRuntimeService(
            SessionRuntimeStore store,
            InterviewPlanRepository plans,
            @Value("${ai-job.plan-timeout:3m}") Duration planTimeout,
            @Value("${ai-job.analysis-timeout:10m}") Duration analysisTimeout) {
        this.store = store;
        this.plans = plans;
        this.planTimeout = planTimeout;
        this.analysisTimeout = analysisTimeout;
    }

    /**
     * 지금 상태.
     *
     * <ul>
     *   <li>Redis에 planStatus가 없을 때 플랜이 있으면 READY, 없으면 FAILED다. 플랜 없이 상태가 사라졌다면 생성 기록을 잃은 것이라 화면이
     *       5.3으로 다시 만들게 한다
     *   <li>GENERATING이 최대 대기 시간(ai-job.plan-timeout, B-11 임시 값)을 넘기면 FAILED로 바꾼다(AI 명세 5장). 그 사이
     *       플랜이 저장됐으면 READY다
     * </ul>
     */
    public SessionRuntime current(long sessionId, Instant now) {
        SessionRuntime stored = store.find(sessionId).orElse(null);
        if (stored == null || stored.planStatus() == null) {
            return withPlanStatus(
                    stored, plans.existsById(sessionId) ? PlanStatus.READY : PlanStatus.FAILED);
        }
        if (stored.planStatus() != PlanStatus.GENERATING || !isPlanTimedOut(sessionId, now)) {
            return stored;
        }
        if (plans.existsById(sessionId)) {
            return withPlanStatus(stored, PlanStatus.READY);
        }
        store.failPlanIfGenerating(sessionId);
        return withPlanStatus(stored, PlanStatus.FAILED);
    }

    /** 되돌려지면 작업은 나가지 않으므로 GENERATING으로 남지 않게 FAILED로 둔다(화면이 5.3으로 다시 만든다) */
    public void startPlan(long sessionId, Instant now) {
        store.startPlan(sessionId, now);
        onRollback(sessionId, () -> store.failPlanIfGenerating(sessionId));
    }

    /** 되돌려지면 보내지 않은 작업의 시작 시각·작업 id가 남지 않게 지운다 */
    public void startAnalysis(long sessionId, Instant now, UUID evaluateJobId) {
        store.startAnalysis(sessionId, now, evaluateJobId);
        onRollback(sessionId, () -> store.clearAnalysis(sessionId));
    }

    /**
     * 결과 생성이 최대 대기 시간(ai-job.analysis-timeout, B-11 임시 값)을 넘겼는지. 면접 상태(DB)를 FAILED로 바꾸는 일은 면접 행을 잠근
     * 서비스가 한다. 시작 시각(Redis)이 TTL 만료·재시작으로 사라졌으면 endedAt(면접 종료 = 처음 결과 생성을 시작한 시각, DB)으로 판단한다. 그렇지
     * 않으면 작업을 잃은 면접이 ANALYZING에 계속 남는다.
     */
    public boolean isAnalysisTimedOut(long sessionId, Instant endedAt, Instant now) {
        Instant startedAt = store.findAnalysisStartedAt(sessionId).orElse(endedAt);
        return startedAt != null && startedAt.plus(analysisTimeout).isBefore(now);
    }

    // 시작 시각이 없으면(기록 전 키) 기다린다
    private boolean isPlanTimedOut(long sessionId, Instant now) {
        return store.findPlanStartedAt(sessionId)
                .map(startedAt -> startedAt.plus(planTimeout).isBefore(now))
                .orElse(false);
    }

    private static void onRollback(long sessionId, Runnable undo) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            return;
        }
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCompletion(int status) {
                        if (status != STATUS_ROLLED_BACK) {
                            return;
                        }
                        try {
                            undo.run();
                        } catch (RuntimeException ex) {
                            LOG.warn("되돌려진 면접 {}의 진행 상태를 되돌리지 못했다", sessionId, ex);
                        }
                    }
                });
    }

    private static SessionRuntime withPlanStatus(SessionRuntime stored, PlanStatus planStatus) {
        return stored == null
                ? new SessionRuntime(planStatus, null, null, 0)
                : new SessionRuntime(
                        planStatus, null, stored.analysisStep(), stored.pausedSeconds());
    }
}
