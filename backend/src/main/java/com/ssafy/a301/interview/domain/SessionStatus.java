package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        description =
                "면접 상태. READY 시작 전 · IN_PROGRESS 면접 중 · ANALYZING 결과 생성 중 · COMPLETED 결과 있음 ·"
                        + " ABORTED 답변 없이 끝남 · FAILED 결과 생성 실패")
public enum SessionStatus {
    READY,
    IN_PROGRESS,
    ANALYZING,
    COMPLETED,
    ABORTED,
    FAILED
}
