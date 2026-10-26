package com.ssafy.a301.common.error;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.springframework.http.HttpStatus;
import tools.jackson.databind.json.JsonMapper;

/** 컨트롤러 밖(보안 필터)에서 GlobalExceptionHandler와 같은 ProblemDetail + code 본문을 쓴다. */
public final class ProblemResponses {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private ProblemResponses() {}

    public static void write(
            HttpServletRequest request, HttpServletResponse response, ErrorCode code)
            throws IOException {
        HttpStatus status = code.status();
        response.setStatus(status.value());
        response.setCharacterEncoding("UTF-8");
        response.setContentType("application/problem+json");
        response.getWriter()
                .write(
                        JSON.writeValueAsString(
                                Map.of(
                                        "title",
                                        status.getReasonPhrase(),
                                        "status",
                                        status.value(),
                                        "detail",
                                        code.message(),
                                        "instance",
                                        request.getRequestURI(),
                                        "code",
                                        code.name())));
    }
}
