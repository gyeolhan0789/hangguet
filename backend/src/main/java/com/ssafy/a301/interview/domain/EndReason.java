package com.ssafy.a301.interview.domain;

/**
 * 그룹 세션이 끝난 이유(docs/그룹면접-설계.md 6.10). 개인 면접은 null이다. ALL_ANSWERED 질문을 모두 마침 · USER_ENDED 끝내기(5.8) ·
 * DISCONNECTED 이탈 2분 초과 · AI_FAILURE 면접관 장애 · CLEANUP 멈춘 그룹 정리(6.11)
 */
public enum EndReason {
    ALL_ANSWERED,
    USER_ENDED,
    DISCONNECTED,
    AI_FAILURE,
    CLEANUP
}
