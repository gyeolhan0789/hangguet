package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.SessionRuntime;
import java.time.Instant;
import java.util.Optional;

/**
 * 진행 중 면접 상태(Redis). AI 분석 작업자와 함께 쓰므로 BE는 자기가 시작하는 필드만 바꾸고, 작업자가 쓴 필드를 통째로 덮어쓰지 않는다(AI 명세 1.2).
 */
public interface SessionRuntimeStore {

    /** 저장된 값. 키가 없으면 비어 있다(만료·작업자만 쓴 경우 포함). */
    Optional<SessionRuntime> find(long sessionId);

    /** 5.1·5.3 플랜 생성 시작: planStatus GENERATING, planProgress 0, 시작 시각(BE만 씀) */
    void startPlan(long sessionId, Instant now);

    /** 플랜 생성을 시작한 시각. 기록이 없으면 비어 있다. */
    Optional<Instant> findPlanStartedAt(long sessionId);

    /** 최대 대기 시간이 지난 플랜 생성을 실패로 바꾼다. 그 사이 작업자가 상태를 바꿨으면 그대로 둔다. */
    void failPlanIfGenerating(long sessionId);

    /** 5.8·5.9 결과 생성 시작: analysisStep ORGANIZING_ANSWERS, 시작 시각(BE만 씀) */
    void startAnalysis(long sessionId, Instant now);

    /** 결과 생성을 시작한 시각. 기록이 없으면 비어 있다. */
    Optional<Instant> findAnalysisStartedAt(long sessionId);
}
