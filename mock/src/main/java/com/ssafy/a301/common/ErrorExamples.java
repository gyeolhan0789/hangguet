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

    private ErrorExamples() {}
}
