package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.SessionRuntime;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** 진행 중 면접 상태(Redis). BE만 쓴다. AI 진행 상황은 결과 메시지를 받아 기록한다(AI 명세 1.2). 필드마다 따로 써서 서로 덮어쓰지 않는다. */
public interface SessionRuntimeStore {

    /** 저장된 값. 키가 없으면 비어 있다(만료·작업자만 쓴 경우 포함). */
    Optional<SessionRuntime> find(long sessionId);

    /** 5.1·5.3 플랜 생성 시작: planStatus GENERATING, planProgress 0, 시작 시각(BE만 씀) */
    void startPlan(long sessionId, Instant now);

    /** 플랜 생성을 시작한 시각. 기록이 없으면 비어 있다. */
    Optional<Instant> findPlanStartedAt(long sessionId);

    /** plan.progress: 플랜 생성 진행률 */
    void updatePlanProgress(long sessionId, int progress);

    /** plan.completed: planStatus READY, 진행률 지움 */
    void markPlanReady(long sessionId);

    /** 최대 대기 시간이 지났거나 plan.failed를 받은 플랜 생성을 실패로 바꾼다. 그 사이 READY가 됐으면 그대로 둔다. */
    void failPlanIfGenerating(long sessionId);

    /**
     * 5.8·5.9 결과 생성 시작: analysisStep ORGANIZING_ANSWERS, 시작 시각, 이번에 보낸 EVALUATE jobId(BE만 씀).
     * jobId는 5.9로 다시 만든 뒤 늦게 온 이전 결과를 거르는 데 쓴다
     */
    void startAnalysis(long sessionId, Instant now, UUID evaluateJobId);

    /** 마지막으로 보낸 EVALUATE jobId. 기록이 없으면 비어 있다. */
    Optional<UUID> findEvaluateJobId(long sessionId);

    /** evaluation.progress: 결과 생성 단계 */
    void updateAnalysisStep(long sessionId, AnalysisStep step);

    /** evaluation.completed·evaluation.failed: 결과 생성 단계 지움 */
    void clearAnalysisStep(long sessionId);

    /** 결과 생성을 시작한 시각. 기록이 없으면 비어 있다. */
    Optional<Instant> findAnalysisStartedAt(long sessionId);
}
