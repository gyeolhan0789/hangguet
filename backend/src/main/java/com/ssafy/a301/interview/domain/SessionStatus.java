package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.Collections;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;

@Schema(
        description =
                "면접 상태. READY 시작 전 · IN_PROGRESS 면접 중 · ANALYZING 결과 생성 중 · COMPLETED 결과 있음 ·"
                    + " ABORTED 답변 없이 끝남 · FAILED 결과 생성 실패 · START_FAILED 배정 거절 · 면접관 미입장 · 첫 질문 기한"
                    + " 초과로 시작 못 함(5.4로 다시 시작)")
public enum SessionStatus {
    READY,
    IN_PROGRESS,
    ANALYZING,
    COMPLETED,
    ABORTED,
    FAILED,
    START_FAILED;

    /** 연습 면접의 상태: 답변 1개 이상으로 끝난 면접(API 명세 1장). 스트릭·면접 수·연습 시간·연습 기록 목록이 모두 이 기준이다 */
    public static final Set<SessionStatus> PRACTICE =
            Collections.unmodifiableSet(EnumSet.of(ANALYZING, COMPLETED, FAILED));

    /** 네이티브 쿼리에 넘길 PRACTICE의 이름 */
    public static List<String> practiceNames() {
        return PRACTICE.stream().map(Enum::name).toList();
    }
}
