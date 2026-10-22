package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.SessionRuntimeStore;
import org.springframework.stereotype.Service;

/** 진행 중 면접 상태를 읽고 시작 단계를 기록한다. Redis에 planStatus가 없으면 플랜이 저장됐는지로 정한다(AI 명세 1.2). */
@Service
public class SessionRuntimeService {
    private final SessionRuntimeStore store;
    private final InterviewPlanRepository plans;

    public SessionRuntimeService(SessionRuntimeStore store, InterviewPlanRepository plans) {
        this.store = store;
        this.plans = plans;
    }

    /**
     * 지금 상태. Redis에 planStatus가 없을 때 플랜이 있으면 READY, 없으면 FAILED다. 플랜 없이 상태가 사라졌다면 생성 기록을 잃은 것이라 화면이
     * 5.3으로 다시 만들게 한다.
     */
    public SessionRuntime current(long sessionId) {
        SessionRuntime stored = store.find(sessionId).orElse(null);
        if (stored != null && stored.planStatus() != null) {
            return stored;
        }
        PlanStatus planStatus = plans.existsById(sessionId) ? PlanStatus.READY : PlanStatus.FAILED;
        return stored == null
                ? new SessionRuntime(planStatus, null, null, 0)
                : new SessionRuntime(
                        planStatus, null, stored.analysisStep(), stored.pausedSeconds());
    }

    public void startPlan(long sessionId) {
        store.startPlan(sessionId);
    }

    public void startAnalysis(long sessionId) {
        store.startAnalysis(sessionId);
    }
}
