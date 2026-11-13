package com.ssafy.a301.interview.domain;

/** AI 분석 작업 종류(AI 명세 1.3). */
public enum AiJobType {
    // 5.1·5.3 질문·채점 기준 만들기
    PLAN,
    // 4.1 저장 뒤, 주장이 없는 지원서의 5.1·5.3 지원서 주장 추출(면접이 아니라 지원서 단위)
    EXTRACT_CLAIMS,
    // 5.7 답변 채점
    SCORE_ANSWER,
    // 5.8·5.9 결과 만들기
    EVALUATE,
    // 5.8(화상) 녹화 트랙을 mp4 하나로 합치기
    MERGE_RECORDING
}
