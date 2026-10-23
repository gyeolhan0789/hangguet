package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.SessionRuntimeStore;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** 진행 중 면접 상태를 읽고 시작 단계를 기록한다. Redis에 planStatus가 없으면 플랜이 저장됐는지로 정한다(AI 명세 1.2). */
@Service
public class SessionRuntimeService {
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

    public void startPlan(long sessionId, Instant now) {
        store.startPlan(sessionId, now);
    }

    public void startAnalysis(long sessionId, Instant now, UUID evaluateJobId) {
        store.startAnalysis(sessionId, now, evaluateJobId);
    }

    /**
     * 결과 생성이 최대 대기 시간(ai-job.analysis-timeout, B-11 임시 값)을 넘겼는지. 면접 상태(DB)를 FAILED로 바꾸는 일은 면접 행을 잠근
     * 서비스가 한다. 시작 시각이 없으면 기다린다.
     */
    public boolean isAnalysisTimedOut(long sessionId, Instant now) {
        return store.findAnalysisStartedAt(sessionId)
                .map(startedAt -> startedAt.plus(analysisTimeout).isBefore(now))
                .orElse(false);
    }

    // 시작 시각이 없으면(기록 전 키) 기다린다
    private boolean isPlanTimedOut(long sessionId, Instant now) {
        return store.findPlanStartedAt(sessionId)
                .map(startedAt -> startedAt.plus(planTimeout).isBefore(now))
                .orElse(false);
    }

    private static SessionRuntime withPlanStatus(SessionRuntime stored, PlanStatus planStatus) {
        return stored == null
                ? new SessionRuntime(planStatus, null, null, 0)
                : new SessionRuntime(
                        planStatus, null, stored.analysisStep(), stored.pausedSeconds());
    }
}
