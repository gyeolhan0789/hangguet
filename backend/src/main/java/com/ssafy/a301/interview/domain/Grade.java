package com.ssafy.a301.interview.domain;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "3단계. GOOD 좋아요 · NORMAL 보통 · WEAK 아쉬워요. 점수 경계는 B-4")
public enum Grade {
    GOOD,
    NORMAL,
    WEAK;

    // TODO(B-4): 경계값 미정. 아래 숫자는 임시값이며 협의 후 바꾼다
    static final int GOOD_MIN = 80;
    static final int NORMAL_MIN = 60;

    public static Grade of(int score) {
        if (score >= GOOD_MIN) {
            return GOOD;
        }
        if (score >= NORMAL_MIN) {
            return NORMAL;
        }
        return WEAK;
    }

    public static Grade ofNullable(Integer score) {
        return score == null ? null : of(score);
    }
}
