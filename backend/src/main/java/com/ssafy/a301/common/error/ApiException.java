package com.ssafy.a301.common.error;

import java.time.Duration;

/** 업무 오류. GlobalExceptionHandler가 ErrorCode에 맞는 ProblemDetail로 바꾼다. */
public class ApiException extends RuntimeException {

    private final ErrorCode errorCode;
    private final Duration retryAfter;

    public ApiException(ErrorCode errorCode) {
        this(errorCode, null);
    }

    /** 다시 시도할 수 있을 때까지 남은 시간을 함께 알린다(Retry-After 헤더 · retryAfterSeconds) */
    public ApiException(ErrorCode errorCode, Duration retryAfter) {
        super(errorCode.message());
        this.errorCode = errorCode;
        this.retryAfter = retryAfter;
    }

    public ErrorCode errorCode() {
        return errorCode;
    }

    /** 없으면 null */
    public Duration retryAfter() {
        return retryAfter;
    }
}
