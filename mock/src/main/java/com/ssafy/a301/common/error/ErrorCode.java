package com.ssafy.a301.common.error;

import org.springframework.http.HttpStatus;

/** 오류 종류. 응답 ProblemDetail의 code로 나가며, 화면은 이 값으로 분기한다. */
public enum ErrorCode {
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "로그인이 필요해요."),
    TOKEN_EXPIRED(HttpStatus.UNAUTHORIZED, "로그인이 만료됐어요."),
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "입력값을 확인해 주세요."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "잠시 후 다시 시도해 주세요.");

    private final HttpStatus status;
    private final String message;

    ErrorCode(HttpStatus status, String message) {
        this.status = status;
        this.message = message;
    }

    public HttpStatus status() {
        return status;
    }

    public String message() {
        return message;
    }
}
