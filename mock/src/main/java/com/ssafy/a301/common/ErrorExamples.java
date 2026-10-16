package com.ssafy.a301.common;

/** Swagger 오류 응답 예시(ProblemDetail + code). */
public final class ErrorExamples {

    public static final String PROBLEM = "application/problem+json";

    public static final String UNAUTHORIZED =
            """
            { "title": "Unauthorized", "status": 401, "detail": "로그인이 필요해요.",
              "instance": "/api/v1/home", "code": "UNAUTHORIZED" }\
            """;
    public static final String TOKEN_EXPIRED =
            """
            { "title": "Unauthorized", "status": 401, "detail": "로그인이 만료됐어요.",
              "instance": "/api/v1/home", "code": "TOKEN_EXPIRED" }\
            """;
    public static final String VALIDATION_FAILED =
            """
            { "title": "Bad Request", "status": 400, "detail": "입력값을 확인해 주세요.",
              "instance": "/api/v1/auth/signup", "code": "VALIDATION_FAILED",
              "errors": [ { "field": "password", "reason": "8~64자, 영문과 숫자를 모두 포함해야 합니다." } ] }\
            """;
    public static final String INTERNAL_ERROR =
            """
            { "title": "Internal Server Error", "status": 500, "detail": "잠시 후 다시 시도해 주세요.",
              "instance": "/api/v1/home", "code": "INTERNAL_ERROR" }\
            """;

    public static final String LOGIN_FAILED =
            """
            { "title": "Unauthorized", "status": 401, "detail": "이메일 또는 비밀번호를 확인해 주세요.",
              "instance": "/api/v1/auth/login", "code": "LOGIN_FAILED" }\
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
    public static final String APPLICATION_IN_USE =
            """
            { "title": "Conflict", "status": 409, "detail": "면접에 사용한 지원서는 수정하거나 삭제할 수 없어요.",
              "instance": "/api/v1/applications/9", "code": "APPLICATION_IN_USE" }\
            """;

    private ErrorExamples() {}
}
