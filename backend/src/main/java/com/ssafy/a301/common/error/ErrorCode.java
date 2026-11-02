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
    PASSWORD_NOT_SET(HttpStatus.CONFLICT, "소셜 로그인 회원은 비밀번호가 없어요."),
    SOCIAL_LOGIN_FAILED(HttpStatus.UNAUTHORIZED, "소셜 로그인에 실패했어요. 다시 시도해 주세요."),
    SOCIAL_LOGIN_UNAVAILABLE(
            HttpStatus.SERVICE_UNAVAILABLE, "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요."),
    SOCIAL_EMAIL_REQUIRED(HttpStatus.BAD_REQUEST, "이메일 제공에 동의해야 가입할 수 있어요."),
    SOCIAL_EMAIL_DUPLICATED(HttpStatus.CONFLICT, "이미 가입한 이메일이에요. 처음 가입한 방법으로 로그인해 주세요."),
    SIGNUP_TOKEN_INVALID(HttpStatus.UNAUTHORIZED, "가입 시간이 지났어요. 다시 로그인해 주세요."),
    SOCIAL_LINK_FAILED(HttpStatus.BAD_REQUEST, "카카오 계정을 확인하지 못했어요. 다시 시도해 주세요."),
    SOCIAL_ALREADY_LINKED(HttpStatus.CONFLICT, "이미 연결한 소셜 계정이 있어요."),
    SOCIAL_ACCOUNT_IN_USE(HttpStatus.CONFLICT, "다른 회원이 쓰고 있는 카카오 계정이에요."),
    FILE_NOT_FOUND(HttpStatus.NOT_FOUND, "업로드한 파일을 찾을 수 없어요."),

    // 연습 알림
    PRACTICE_ALARM_UNAVAILABLE(HttpStatus.CONFLICT, "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요."),
    KAKAO_CONSENT_FAILED(HttpStatus.BAD_REQUEST, "카카오 동의를 확인하지 못했어요. 다시 시도해 주세요."),
    KAKAO_ACCOUNT_MISMATCH(HttpStatus.BAD_REQUEST, "로그인에 쓰는 카카오 계정으로 동의해 주세요."),
    KAKAO_MESSAGE_CONSENT_REQUIRED(HttpStatus.BAD_REQUEST, "카카오톡 메시지 전송에 동의해야 알림을 받을 수 있어요."),
    KAKAO_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "카카오 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요."),

    // 지원서
    APPLICATION_NOT_FOUND(HttpStatus.NOT_FOUND, "지원서를 찾을 수 없어요."),
    COVER_LETTER_CHECK_UNAVAILABLE(
            HttpStatus.SERVICE_UNAVAILABLE, "자기소개서를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."),

    // 면접 진행
    SESSION_NOT_FOUND(HttpStatus.NOT_FOUND, "면접을 찾을 수 없어요."),
    QUESTION_NOT_FOUND(HttpStatus.NOT_FOUND, "질문을 찾을 수 없어요."),
    IDEMPOTENCY_KEY_REUSED(HttpStatus.CONFLICT, "이미 처리된 요청이에요."),
    INVALID_SESSION_STATE(HttpStatus.CONFLICT, "지금은 할 수 없는 요청이에요."),
    PLAN_NOT_READY(HttpStatus.CONFLICT, "면접관이 질문을 준비하고 있어요."),
    PLAN_NOT_FAILED(HttpStatus.CONFLICT, "면접 준비가 실패한 상태가 아니에요."),
    ANSWER_ALREADY_SUBMITTED(HttpStatus.CONFLICT, "이미 답변한 질문이에요."),
    ROOM_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "면접방을 열지 못했어요. 잠시 후 다시 시도해 주세요."),

    // 결과·성장 리뷰
    RESULT_NOT_READY(HttpStatus.CONFLICT, "결과를 만들고 있어요."),
    NO_RESULT(HttpStatus.CONFLICT, "답변 없이 끝난 면접은 결과가 없어요."),
    GROWTH_REVIEW_NOT_FOUND(HttpStatus.NOT_FOUND, "그날의 성장 리뷰가 없어요."),

    // 관리자·공지·스트릭 유지권
    ADMIN_LOGIN_FAILED(HttpStatus.UNAUTHORIZED, "아이디 또는 비밀번호를 확인해 주세요."),
    NOTICE_NOT_FOUND(HttpStatus.NOT_FOUND, "공지를 찾을 수 없어요."),
    USER_NOT_FOUND(HttpStatus.NOT_FOUND, "회원을 찾을 수 없어요."),
    STREAK_FREEZE_NOT_FOUND(HttpStatus.NOT_FOUND, "유지권을 찾을 수 없어요."),
    STREAK_FREEZE_NOT_AVAILABLE(HttpStatus.CONFLICT, "이미 썼거나 기간이 지난 유지권이에요."),
    STREAK_FREEZE_DATE_NOT_ALLOWED(HttpStatus.CONFLICT, "이미 연습한 날이라 메울 수 없어요."),

    // 문의
    INQUIRY_NOT_FOUND(HttpStatus.NOT_FOUND, "문의를 찾을 수 없어요."),
    INQUIRY_CLOSED(HttpStatus.CONFLICT, "종료한 문의예요.");

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
