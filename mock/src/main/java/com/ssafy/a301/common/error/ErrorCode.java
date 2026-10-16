package com.ssafy.a301.common.error;

import org.springframework.http.HttpStatus;

/** 오류 종류. 응답 ProblemDetail의 code로 나가며, 화면은 이 값으로 분기한다. */
public enum ErrorCode {
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "로그인이 필요해요."),
    TOKEN_EXPIRED(HttpStatus.UNAUTHORIZED, "로그인이 만료됐어요."),
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "입력값을 확인해 주세요."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "잠시 후 다시 시도해 주세요."),

    // 인증·회원
    LOGIN_FAILED(HttpStatus.UNAUTHORIZED, "이메일 또는 비밀번호를 확인해 주세요."),
    REFRESH_TOKEN_INVALID(HttpStatus.UNAUTHORIZED, "다시 로그인해 주세요."),
    AGREEMENT_REQUIRED(HttpStatus.BAD_REQUEST, "필수 약관에 모두 동의해 주세요."),
    EMAIL_DUPLICATED(HttpStatus.CONFLICT, "이미 사용 중인 이메일이에요."),
    PASSWORD_MISMATCH(HttpStatus.BAD_REQUEST, "비밀번호가 맞지 않아요."),
    FILE_NOT_FOUND(HttpStatus.NOT_FOUND, "업로드한 파일을 찾을 수 없어요."),

    // 지원서
    APPLICATION_NOT_FOUND(HttpStatus.NOT_FOUND, "지원서를 찾을 수 없어요."),
    APPLICATION_IN_USE(HttpStatus.CONFLICT, "면접에 사용한 지원서는 수정하거나 삭제할 수 없어요.");

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
