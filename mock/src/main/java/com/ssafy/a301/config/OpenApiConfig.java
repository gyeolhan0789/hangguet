package com.ssafy.a301.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.PathItem;
import io.swagger.v3.oas.models.Paths;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.media.Schema;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import java.util.Set;
import org.springdoc.core.customizers.OpenApiCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Swagger 문서의 기본 정보, 오류 응답 스키마, 목록 정렬을 정한다. 명세는 docs/API-명세.md에 둔다. */
@Configuration
public class OpenApiConfig {

    private static final String DESCRIPTION =
            """
            한끗(A301) API. 공통 규약, 실시간(WebSocket) 계약, 업무 규칙, 화면 대응, 오류 코드, 보류 목록은 [API 명세 문서](https://lab.ssafy.com/s15-final/S15P31A301/-/blob/develop/docs/API-%EB%AA%85%EC%84%B8.md)에 있다.

            - 실패하면 응답의 `code`로 오류를 구분한다
            - 공통 오류(401 `UNAUTHORIZED`·`TOKEN_EXPIRED`, 400 `VALIDATION_FAILED`, 500 `INTERNAL_ERROR`)는 API별 표기를 생략한다
            - 목 서버는 토큰을 검사하지 않고 예시 응답만 돌려준다
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

    /** 오류 응답 스키마(ProblemDetail)를 등록한다. 공통 오류(401·400·500)는 첫 화면에 한 번만 적고 API마다 붙이지 않는다. */
    @Bean
    public OpenApiCustomizer problemDetailSchema() {
        return openApi -> openApi.getComponents().addSchemas("ProblemDetail", problemDetail());
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

    @SuppressWarnings({"rawtypes", "unchecked"})
    private static Schema problemDetail() {
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
