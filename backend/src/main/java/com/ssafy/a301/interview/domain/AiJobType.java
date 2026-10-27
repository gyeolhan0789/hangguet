package com.ssafy.a301.interview.domain;

/** AI 분석 작업 종류(AI 명세 1.3). */
public enum AiJobType {
    // 5.1·5.3 질문·채점 기준 만들기
    PLAN,
    // 5.7 답변 채점
    SCORE_ANSWER,
    // 5.8·5.9 결과 만들기
    EVALUATE,
    // 5.8(화상) 녹화 트랙을 mp4 하나로 합치기
    MERGE_RECORDING,
    // 임시: headline 없이 끝난 면접의 summary를 30자 한 줄로 줄이기(HeadlineBackfill). 채운 뒤 지운다
    WRITE_HEADLINE
}
