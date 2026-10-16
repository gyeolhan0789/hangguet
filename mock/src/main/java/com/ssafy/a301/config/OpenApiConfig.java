package com.ssafy.a301.config;

import com.ssafy.a301.common.ErrorExamples;
import io.swagger.v3.core.util.Json;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.examples.Example;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.Content;
import io.swagger.v3.oas.models.media.MediaType;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.responses.ApiResponse;
import io.swagger.v3.oas.models.responses.ApiResponses;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import java.util.Map;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Swagger 문서의 기본 정보, 공통 규약, 공통 오류 응답, 목록 정렬을 정한다. */
@Configuration
public class OpenApiConfig {

    private static final String DESCRIPTION =
            """
            한끗(A301) API 명세. 화면 번호(S00~S09·C01)는 화면 설계 기준

            ### 공통 규약
            - **기본 경로** `/api/v1`. Resource는 복수 명사·kebab-case, JSON 필드는 camelCase, enum은 UPPER_SNAKE_CASE
            - **일시** ISO 8601 오프셋 포함(`2026-10-15T12:00:00+09:00`), **날짜** `YYYY-MM-DD`(한국 시간)
            - **인증** `Authorization: Bearer {accessToken}`. 자물쇠 없는 API만 토큰 없이 호출. 회원은 토큰으로만 식별(본문·경로로 회원 id를 받지 않음)
            - 다른 회원의 리소스는 존재 여부를 숨기기 위해 **404**. 탈퇴한 회원의 데이터는 조회되지 않음
            - **성공 응답** 래퍼 없이 리소스 그대로. 본문 없는 성공은 204. 페이지 목록은 `{ content, page: { size, number(0부터), totalElements, totalPages } }`
            - **실패 응답** RFC 9457 ProblemDetail(`title`·`status`·`detail`·`instance`, `type`은 기본값 `about:blank`라 생략) + `code`. 화면 분기는 `code`로 한다. 400 `VALIDATION_FAILED`는 `errors[{ field, reason }]` 추가
            - **모든 API 공통 오류** 401 `UNAUTHORIZED`(토큰 없음·위조·탈퇴) · 401 `TOKEN_EXPIRED`(만료 → 토큰 재발급 후 재요청) · 400 `VALIDATION_FAILED` · 500 `INTERNAL_ERROR`(문구 고정 "잠시 후 다시 시도해 주세요.")
            - **멱등성** 면접 만들기·시작·답변 제출·끝내기는 `Idempotency-Key: {UUID}` 필수. 같은 키·같은 본문 = 처음 결과 반환, 같은 키·다른 본문 = 409 `IDEMPOTENCY_KEY_REUSED`, 헤더 없음 = 400
            - **파일** 음성·영상·사진은 Presigned URL로 브라우저가 S3에 직접 올리고 받음. API·WebSocket으로 파일을 보내지 않음

            ### 이 목 서버
            실제 로직 없이 명세의 예시 응답을 돌려준다. 인증·DB는 없다.
            """;

    @Bean
    public OpenAPI openApi() {
        return new OpenAPI()
                .info(new Info().title("한끗 A301 API").version("v0.1").description(DESCRIPTION))
                .components(
                        new Components()
                                .addSecuritySchemes(
                                        "bearer",
                                        new SecurityScheme()
                                                .type(SecurityScheme.Type.HTTP)
                                                .scheme("bearer")
                                                .bearerFormat("JWT")))
                .addSecurityItem(new SecurityRequirement().addList("bearer"));
    }

    /** 모든 API 공통 응답(401·400·500)을 각 API에 붙인다. 이미 적은 상태 코드는 건드리지 않는다. */
    @Bean
    public OpenApiCustomizer commonErrorResponses() {
        return openApi -> {
            openApi.getComponents().addSchemas("ProblemDetail", problemDetailSchema());
            if (openApi.getPaths() == null) {
                return;
            }
            for (PathItem path : openApi.getPaths().values()) {
                for (Operation op : path.readOperations()) {
                    addCommonErrors(op);
                }
            }
        };
    }

    private static void addCommonErrors(Operation op) {
        ApiResponses responses = op.getResponses();
        boolean secured = op.getSecurity() == null || !op.getSecurity().isEmpty();
        boolean hasInput =
                op.getRequestBody() != null
                        || (op.getParameters() != null && !op.getParameters().isEmpty());
        addIfAbsent(
                responses,
                "401",
                secured,
                "인증 실패 · 만료",
                Map.of(
                        "UNAUTHORIZED", ErrorExamples.UNAUTHORIZED,
                        "TOKEN_EXPIRED", ErrorExamples.TOKEN_EXPIRED));
        addIfAbsent(
                responses,
                "400",
                hasInput,
                "입력값 오류",
                Map.of("VALIDATION_FAILED", ErrorExamples.VALIDATION_FAILED));
        addIfAbsent(
                responses,
                "500",
                true,
                "처리 실패",
                Map.of("INTERNAL_ERROR", ErrorExamples.INTERNAL_ERROR));
    }

    /** Swagger 목록을 명세 번호(summary 앞의 "5.10" 등) 순으로 정렬한다. */
    @Bean
    public OpenApiCustomizer sortByApiNumber() {
        return openApi -> {
            if (openApi.getPaths() == null) {
                return;
            }
            Paths sorted = new Paths();
            openApi.getPaths().entrySet().stream()
                    .sorted((x, y) -> compare(apiNumber(x.getValue()), apiNumber(y.getValue())))
                    .forEach(e -> sorted.addPathItem(e.getKey(), e.getValue()));
            openApi.setPaths(sorted);
        };
    }

    private static void addIfAbsent(
            ApiResponses responses,
            String status,
            boolean applies,
            String description,
            Map<String, String> examples) {
        if (applies && !responses.containsKey(status)) {
            responses.addApiResponse(status, problem(description, examples));
        }
    }

    private static ApiResponse problem(String description, Map<String, String> examples) {
        MediaType mediaType =
                new MediaType().schema(new Schema<>().$ref("#/components/schemas/ProblemDetail"));
        examples.forEach(
                (name, json) -> {
                    try {
                        mediaType.addExamples(
                                name, new Example().value(Json.mapper().readTree(json)));
                    } catch (Exception e) {
                        throw new IllegalStateException("오류 예시 JSON이 잘못됨: " + name, e);
                    }
                });
        return new ApiResponse()
                .description(description)
                .content(new Content().addMediaType(ErrorExamples.PROBLEM, mediaType));
    }

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static Schema problemDetailSchema() {
        return typed("object")
                .description("실패 응답(RFC 9457). `type`은 기본값 about:blank라 생략")
                .addProperty("title", typed("string").description("HTTP 상태 이름"))
                .addProperty("status", typed("integer").description("HTTP 상태 코드"))
                .addProperty("detail", typed("string").description("사용자에게 보여 줄 문구"))
                .addProperty("instance", typed("string").description("요청 경로"))
                .addProperty("code", typed("string").description("오류 종류. 화면 분기는 이 값으로 한다"))
                .addProperty(
                        "errors",
                        typed("array")
                                .description("400 VALIDATION_FAILED일 때만. 칸별 실패 사유")
                                .items(
                                        typed("object")
                                                .addProperty(
                                                        "field",
                                                        typed("string").description("요청 필드명"))
                                                .addProperty(
                                                        "reason",
                                                        typed("string").description("요구 조건"))));
    }

    // OpenAPI 3.1 문서는 type 대신 types로 써야 JSON에 나간다
    @SuppressWarnings("rawtypes")
    private static Schema typed(String type) {
        return new Schema<>().types(Set.of(type));
    }

    private static double[] apiNumber(PathItem item) {
        return item.readOperations().stream()
                .map(op -> op.getSummary() == null ? "99.99" : op.getSummary().split(" ")[0])
                .map(n -> n.split("\\."))
                .map(
                        p ->
                                new double[] {
                                    Double.parseDouble(p[0]),
                                    p.length > 1 ? Double.parseDouble(p[1]) : 0
                                })
                .min(OpenApiConfig::compare)
                .orElse(new double[] {99, 99});
    }

    private static int compare(double[] a, double[] b) {
        return a[0] != b[0] ? Double.compare(a[0], b[0]) : Double.compare(a[1], b[1]);
    }
}
