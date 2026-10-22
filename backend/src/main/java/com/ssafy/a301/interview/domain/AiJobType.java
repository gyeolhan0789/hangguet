package com.ssafy.a301.interview.domain;

/** AI 분석 작업 종류(AI 명세 1.3). */
public enum AiJobType {
    // 5.1·5.3 질문·채점 기준 만들기
    PLAN,
    // 5.7 답변 채점
    SCORE_ANSWER,
    // 5.8·5.9 결과 만들기
    EVALUATE
}
