package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;

// Redis에 둔다(진행 중 면접 상태)
@Schema(
        description =
                "면접 플랜(질문·평가 기준) 상태. GENERATING 만드는 중(S05 [면접 시작] 비활성) · READY 완료 · FAILED 실패(5.3으로"
                        + " 재시도)")
public enum PlanStatus {
    GENERATING,
    READY,
    FAILED
}
