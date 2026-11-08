package com.ssafy.a301.common;

/** Swagger 오류 응답 예시(ProblemDetail + code). */
public final class ErrorExamples {

    public static final String PROBLEM = "application/problem+json";

    public static final String VALIDATION_FAILED =
            """
            { "title": "Bad Request", "status": 400, "detail": "입력값을 확인해 주세요.",
              "instance": "/api/v1/auth/signup", "code": "VALIDATION_FAILED",
              "errors": [ { "field": "password", "reason": "8~64자, 영문과 숫자를 모두 포함해야 합니다." } ] }\
            """;

    public static final String PROFILE_IMAGE_KEY_INVALID =
            """
            { "title": "Bad Request", "status": 400, "detail": "입력값을 확인해 주세요.",
              "instance": "/api/v1/users/me/profile-image", "code": "VALIDATION_FAILED",
              "errors": [ { "field": "objectKey", "reason": "본인에게 발급된 키가 아닙니다." } ] }\
            """;

    public static final String PAGE_SIZE_INVALID =
            """
            { "title": "Bad Request", "status": 400, "detail": "입력값을 확인해 주세요.",
              "instance": "/api/v1/applications/12/interview-sessions", "code": "VALIDATION_FAILED",
              "errors": [ { "field": "size", "reason": "1~20입니다." } ] }\
            """;

    public static final String INTERNAL_ERROR =
            """
            { "title": "Internal Server Error", "status": 500, "detail": "잠시 후 다시 시도해 주세요.",
              "instance": "/api/v1/applications/12/interview-sessions", "code": "INTERNAL_ERROR" }\
            """;

    public static final String GAZE_RATIO_INVALID =
            """
            { "title": "Bad Request", "status": 400, "detail": "입력값을 확인해 주세요.",
              "instance": "/api/v1/interview-sessions/55/end", "code": "VALIDATION_FAILED",
              "errors": [ { "field": "gazeRatio", "reason": "0~100입니다." } ] }\
            """;

    public static final String LOGIN_FAILED =
            """
            { "title": "Unauthorized", "status": 401, "detail": "이메일 또는 비밀번호를 확인해 주세요.",
              "instance": "/api/v1/auth/login", "code": "LOGIN_FAILED" }\
            """;
    public static final String LOGIN_LOCKED =
            """
            { "title": "Too Many Requests", "status": 429,
              "detail": "로그인에 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.",
              "instance": "/api/v1/auth/login", "code": "LOGIN_LOCKED", "retryAfterSeconds": 900 }\
            """;
    public static final String REFRESH_TOKEN_INVALID =
            """
            { "title": "Unauthorized", "status": 401, "detail": "다시 로그인해 주세요.",
              "instance": "/api/v1/auth/token/refresh", "code": "REFRESH_TOKEN_INVALID" }\
            """;
    public static final String AGREEMENT_REQUIRED =
            """
            { "title": "Bad Request", "status": 400, "detail": "필수 약관에 모두 동의해 주세요.",
              "instance": "/api/v1/auth/signup", "code": "AGREEMENT_REQUIRED" }\
            """;
    public static final String EMAIL_DUPLICATED =
            """
            { "title": "Conflict", "status": 409, "detail": "이미 사용 중인 이메일이에요.",
              "instance": "/api/v1/auth/signup", "code": "EMAIL_DUPLICATED" }\
            """;
    public static final String PASSWORD_MISMATCH =
            """
            { "title": "Bad Request", "status": 400, "detail": "비밀번호가 맞지 않아요.",
              "instance": "/api/v1/users/me/password", "code": "PASSWORD_MISMATCH" }\
            """;
    public static final String PASSWORD_NOT_SET =
            """
            { "title": "Conflict", "status": 409, "detail": "소셜 로그인 회원은 비밀번호가 없어요.",
              "instance": "/api/v1/users/me/password", "code": "PASSWORD_NOT_SET" }\
            """;
    public static final String PRACTICE_ALARM_UNAVAILABLE =
            """
            { "title": "Conflict", "status": 409, "detail": "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요.",
              "instance": "/api/v1/users/me/practice-alarm", "code": "PRACTICE_ALARM_UNAVAILABLE" }\
            """;
    public static final String KAKAO_CONSENT_FAILED =
            """
            { "title": "Bad Request", "status": 400, "detail": "카카오 동의를 확인하지 못했어요. 다시 시도해 주세요.",
              "instance": "/api/v1/users/me/practice-alarm", "code": "KAKAO_CONSENT_FAILED" }\
            """;
    public static final String KAKAO_ACCOUNT_MISMATCH =
            """
            { "title": "Bad Request", "status": 400, "detail": "로그인에 쓰는 카카오 계정으로 동의해 주세요.",
              "instance": "/api/v1/users/me/practice-alarm", "code": "KAKAO_ACCOUNT_MISMATCH" }\
            """;
    public static final String KAKAO_MESSAGE_CONSENT_REQUIRED =
            """
            { "title": "Bad Request", "status": 400, "detail": "카카오톡 메시지 전송에 동의해야 알림을 받을 수 있어요.",
              "instance": "/api/v1/users/me/practice-alarm", "code": "KAKAO_MESSAGE_CONSENT_REQUIRED" }\
            """;
    public static final String KAKAO_UNAVAILABLE =
            """
            { "title": "Service Unavailable", "status": 503, "detail": "카카오 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
              "instance": "/api/v1/users/me/practice-alarm", "code": "KAKAO_UNAVAILABLE" }\
            """;
    public static final String SOCIAL_LOGIN_FAILED =
            """
            { "title": "Unauthorized", "status": 401, "detail": "소셜 로그인에 실패했어요. 다시 시도해 주세요.",
              "instance": "/api/v1/auth/oauth/kakao", "code": "SOCIAL_LOGIN_FAILED" }\
            """;
    public static final String SOCIAL_LOGIN_UNAVAILABLE =
            """
            { "title": "Service Unavailable", "status": 503, "detail": "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
              "instance": "/api/v1/auth/oauth/kakao", "code": "SOCIAL_LOGIN_UNAVAILABLE" }\
            """;
    public static final String SOCIAL_EMAIL_REQUIRED =
            """
            { "title": "Bad Request", "status": 400, "detail": "이메일 제공에 동의해야 가입할 수 있어요.",
              "instance": "/api/v1/auth/oauth/kakao", "code": "SOCIAL_EMAIL_REQUIRED" }\
            """;
    public static final String SOCIAL_EMAIL_DUPLICATED =
            """
            { "title": "Conflict", "status": 409, "detail": "이미 가입한 이메일이에요. 처음 가입한 방법으로 로그인해 주세요.",
              "instance": "/api/v1/auth/oauth/kakao", "code": "SOCIAL_EMAIL_DUPLICATED" }\
            """;
    public static final String SIGNUP_TOKEN_INVALID =
            """
            { "title": "Unauthorized", "status": 401, "detail": "가입 시간이 지났어요. 다시 로그인해 주세요.",
              "instance": "/api/v1/auth/oauth/signup", "code": "SIGNUP_TOKEN_INVALID" }\
            """;
    public static final String SOCIAL_LINK_FAILED =
            """
            { "title": "Bad Request", "status": 400, "detail": "카카오 계정을 확인하지 못했어요. 다시 시도해 주세요.",
              "instance": "/api/v1/users/me/social-accounts/kakao", "code": "SOCIAL_LINK_FAILED" }\
            """;
    public static final String SOCIAL_ALREADY_LINKED =
            """
            { "title": "Conflict", "status": 409, "detail": "이미 연결한 소셜 계정이 있어요.",
              "instance": "/api/v1/users/me/social-accounts/kakao", "code": "SOCIAL_ALREADY_LINKED" }\
            """;
    public static final String SOCIAL_ACCOUNT_IN_USE =
            """
            { "title": "Conflict", "status": 409, "detail": "다른 회원이 쓰고 있는 카카오 계정이에요.",
              "instance": "/api/v1/users/me/social-accounts/kakao", "code": "SOCIAL_ACCOUNT_IN_USE" }\
            """;
    public static final String ATTACHMENT_KEY_INVALID =
            """
            { "title": "Bad Request", "status": 400, "detail": "입력값을 확인해 주세요.",
              "instance": "/api/v1/inquiries", "code": "VALIDATION_FAILED",
              "errors": [ { "field": "attachmentKeys", "reason": "발급되지 않았거나 이미 쓴 키입니다." } ] }\
            """;
    public static final String INQUIRY_FILE_NOT_FOUND =
            """
            { "title": "Not Found", "status": 404, "detail": "업로드한 파일을 찾을 수 없어요.",
              "instance": "/api/v1/inquiries", "code": "FILE_NOT_FOUND" }\
            """;
    public static final String FILE_NOT_FOUND =
            """
            { "title": "Not Found", "status": 404, "detail": "업로드한 파일을 찾을 수 없어요.",
              "instance": "/api/v1/users/me/profile-image", "code": "FILE_NOT_FOUND" }\
            """;
    public static final String APPLICATION_NOT_FOUND =
            """
            { "title": "Not Found", "status": 404, "detail": "지원서를 찾을 수 없어요.",
              "instance": "/api/v1/applications/0", "code": "APPLICATION_NOT_FOUND" }\
            """;
    public static final String COVER_LETTER_UNUSABLE =
            """
            { "title": "Bad Request", "status": 400, "detail": "입력값을 확인해 주세요.",
              "instance": "/api/v1/applications", "code": "VALIDATION_FAILED",
              "errors": [ { "field": "coverLetterItems", "reason": "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요." } ] }\
            """;
    public static final String COVER_LETTER_CHECK_UNAVAILABLE =
            """
            { "title": "Service Unavailable", "status": 503, "detail": "자기소개서를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.",
              "instance": "/api/v1/applications", "code": "COVER_LETTER_CHECK_UNAVAILABLE" }\
            """;
    public static final String SESSION_NOT_FOUND =
            """
            { "title": "Not Found", "status": 404, "detail": "면접을 찾을 수 없어요.",
              "instance": "/api/v1/interview-sessions/0", "code": "SESSION_NOT_FOUND" }\
            """;
    public static final String QUESTION_NOT_FOUND =
            """
            { "title": "Not Found", "status": 404, "detail": "질문을 찾을 수 없어요.",
              "instance": "/api/v1/interview-sessions/55/questions/0/answer", "code": "QUESTION_NOT_FOUND" }\
            """;
    public static final String IDEMPOTENCY_KEY_REUSED =
            """
            { "title": "Conflict", "status": 409, "detail": "이미 처리된 요청이에요.",
              "instance": "/api/v1/interview-sessions", "code": "IDEMPOTENCY_KEY_REUSED" }\
            """;
    public static final String INVALID_SESSION_STATE =
            """
            { "title": "Conflict", "status": 409, "detail": "지금은 할 수 없는 요청이에요.",
              "instance": "/api/v1/interview-sessions/55/start", "code": "INVALID_SESSION_STATE" }\
            """;
    public static final String PLAN_NOT_READY =
            """
            { "title": "Conflict", "status": 409, "detail": "면접관이 질문을 준비하고 있어요.",
              "instance": "/api/v1/interview-sessions/55/start", "code": "PLAN_NOT_READY" }\
            """;
    public static final String PLAN_NOT_FAILED =
            """
            { "title": "Conflict", "status": 409, "detail": "면접 준비가 실패한 상태가 아니에요.",
              "instance": "/api/v1/interview-sessions/55/plan/retry", "code": "PLAN_NOT_FAILED" }\
            """;
    public static final String ANSWER_ALREADY_SUBMITTED =
            """
            { "title": "Conflict", "status": 409, "detail": "이미 답변한 질문이에요.",
              "instance": "/api/v1/interview-sessions/55/questions/303/answer", "code": "ANSWER_ALREADY_SUBMITTED" }\
            """;
    public static final String ROOM_UNAVAILABLE =
            """
            { "title": "Service Unavailable", "status": 503, "detail": "면접방을 열지 못했어요. 잠시 후 다시 시도해 주세요.",
              "instance": "/api/v1/interview-sessions/55/start", "code": "ROOM_UNAVAILABLE" }\
            """;
    public static final String INTERVIEW_CAPACITY_FULL =
            """
            { "title": "Service Unavailable", "status": 503, "detail": "지금 진행 중인 면접이 많아요. 잠시 후 다시 시작해 주세요.",
              "instance": "/api/v1/interview-sessions/55/start", "code": "INTERVIEW_CAPACITY_FULL" }\
            """;
    public static final String RESULT_NOT_READY =
            """
            { "title": "Conflict", "status": 409, "detail": "결과를 만들고 있어요.",
              "instance": "/api/v1/interview-sessions/55/result", "code": "RESULT_NOT_READY" }\
            """;
    public static final String NO_RESULT =
            """
            { "title": "Conflict", "status": 409, "detail": "답변 없이 끝난 면접은 결과가 없어요.",
              "instance": "/api/v1/interview-sessions/55/result", "code": "NO_RESULT" }\
            """;
    public static final String GROWTH_REVIEW_NOT_FOUND =
            """
            { "title": "Not Found", "status": 404, "detail": "그날의 성장 리뷰가 없어요.",
              "instance": "/api/v1/growth-reviews/2026-10-01", "code": "GROWTH_REVIEW_NOT_FOUND" }\
            """;
    public static final String ADMIN_LOGIN_FAILED =
            """
            { "title": "Unauthorized", "status": 401, "detail": "아이디 또는 비밀번호를 확인해 주세요.",
              "instance": "/api/v1/admin/auth/login", "code": "ADMIN_LOGIN_FAILED" }\
            """;
    public static final String NOTICE_NOT_FOUND =
            """
            { "title": "Not Found", "status": 404, "detail": "공지를 찾을 수 없어요.",
              "instance": "/api/v1/admin/notices/0", "code": "NOTICE_NOT_FOUND" }\
            """;
    public static final String USER_NOT_FOUND =
            """
            { "title": "Not Found", "status": 404, "detail": "회원을 찾을 수 없어요.",
              "instance": "/api/v1/admin/streak-freeze-grants", "code": "USER_NOT_FOUND" }\
            """;
    public static final String STREAK_FREEZE_NOT_FOUND =
            """
            { "title": "Not Found", "status": 404, "detail": "유지권을 찾을 수 없어요.",
              "instance": "/api/v1/users/me/streak-freezes/use", "code": "STREAK_FREEZE_NOT_FOUND" }\
            """;
    public static final String STREAK_FREEZE_NOT_AVAILABLE =
            """
            { "title": "Conflict", "status": 409, "detail": "이미 썼거나 기간이 지난 유지권이에요.",
              "instance": "/api/v1/users/me/streak-freezes/use", "code": "STREAK_FREEZE_NOT_AVAILABLE" }\
            """;
    public static final String STREAK_FREEZE_DATE_NOT_ALLOWED =
            """
            { "title": "Conflict", "status": 409, "detail": "이미 연습한 날이라 메울 수 없어요.",
              "instance": "/api/v1/users/me/streak-freezes/use", "code": "STREAK_FREEZE_DATE_NOT_ALLOWED" }\
            """;
    public static final String INQUIRY_NOT_FOUND =
            """
            { "title": "Not Found", "status": 404, "detail": "문의를 찾을 수 없어요.",
              "instance": "/api/v1/inquiries/0", "code": "INQUIRY_NOT_FOUND" }\
            """;
    public static final String INQUIRY_CLOSED =
            """
            { "title": "Conflict", "status": 409, "detail": "종료한 문의예요.",
              "instance": "/api/v1/inquiries/7/messages", "code": "INQUIRY_CLOSED" }\
            """;

    private ErrorExamples() {}
}
