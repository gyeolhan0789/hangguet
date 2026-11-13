package com.ssafy.a301.interview.domain;

import java.time.Duration;
import java.time.OffsetDateTime;

/**
 * 진행 중 면접 상태. DB가 아니라 Redis에 둔다.
 *
 * @param planStatus 면접 플랜 생성 상태
 * @param planProgress 플랜 준비 진행률 0~100. GENERATING일 때만 값
 * @param analysisStep 결과 생성 단계. 면접이 ANALYZING일 때만 값
 * @param pausedSeconds 연결이 끊겨 멈춘 시간의 합(초). 경과 시간에서 뺀다
 */
public record SessionRuntime(
        PlanStatus planStatus,
        Integer planProgress,
        AnalysisStep analysisStep,
        long pausedSeconds) {

    public static SessionRuntime generating() {
        return new SessionRuntime(PlanStatus.GENERATING, 0, null, 0);
    }

    public static SessionRuntime ready() {
        return new SessionRuntime(PlanStatus.READY, null, null, 0);
    }

    // 면접 경과 시간(초). 시작 전이면 0, 끝났으면 종료 시각 기준
    public int elapsedSeconds(InterviewSession session, OffsetDateTime now) {
        if (session.getStartedAt() == null) {
            return 0;
        }
        OffsetDateTime until = session.getEndedAt() != null ? session.getEndedAt() : now;
        long seconds = Duration.between(session.getStartedAt(), until).toSeconds() - pausedSeconds;
        return (int) Math.max(0, seconds);
    }
}
