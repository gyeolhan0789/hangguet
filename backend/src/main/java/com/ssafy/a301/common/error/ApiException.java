package com.ssafy.a301.common.error;

/** 업무 오류. GlobalExceptionHandler가 ErrorCode에 맞는 ProblemDetail로 바꾼다. */
public class ApiException extends RuntimeException {

    private final ErrorCode errorCode;

    public ApiException(ErrorCode errorCode) {
        super(errorCode.message());
        this.errorCode = errorCode;
    }

    public ErrorCode errorCode() {
        return errorCode;
    }
}
