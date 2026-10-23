package com.ssafy.a301.interview.service;

/** 다시 처리해도 저장할 수 없는 AI 결과 메시지(JSON 아님, 모르는 종류, 필수 필드 없음). 실패 목록으로 옮긴다. */
public class InvalidAiResultException extends RuntimeException {

    public InvalidAiResultException(String message) {
        super(message);
    }

    public InvalidAiResultException(String message, Throwable cause) {
        super(message, cause);
    }
}
