package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;

// Redis에 둔다(진행 중 면접 상태)
@Schema(
        description =
                "결과 생성 단계(S06-1 체크 목록). ORGANIZING_ANSWERS 답변 정리 → SCORING 기준별 분석 →"
                        + " WRITING_FEEDBACK 피드백 작성")
public enum AnalysisStep {
    ORGANIZING_ANSWERS,
    SCORING,
    WRITING_FEEDBACK
}
