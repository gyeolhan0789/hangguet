package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(
        description =
                "평가 기준. 화면 이름: JOB_FIT 직무 적합성 · COVER_LETTER 자소서 검증 · LOGIC 논리성 · DELIVERY 전달력")
public enum Criterion {
    JOB_FIT,
    COVER_LETTER,
    LOGIC,
    DELIVERY
}
