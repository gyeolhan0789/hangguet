package com.ssafy.a301.config;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/** OpenAPI 문서가 생성되고 공통 오류 스키마와 요청 예시가 들어 있는지 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
class OpenApiDocTest {

    @Autowired private MockMvcTester mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @Test
    void apiDocsHasProblemDetailSchema() {
        assertThat(mockMvc.get().uri("/v3/api-docs"))
                .hasStatus(HttpStatus.OK)
                .bodyJson()
                .extractingPath("$.components.schemas.ProblemDetail.properties.code.type")
                .isEqualTo("string");
    }

    @Test
    void swaggerSortsIndividualOperationsBySummaryNumber() {
        assertThat(mockMvc.get().uri("/swagger-ui/swagger-initializer.js"))
                .hasStatus(HttpStatus.OK)
                .bodyText()
                .contains("operationsSorter: (a, b) =>", "item.getIn(['operation', 'summary'])");
    }

    @Test
    void practiceCalendarDocumentsOnlyMonthWithOneSharedStartDateBasis() {
        assertThat(mockMvc.get().uri("/v3/api-docs"))
                .hasStatus(HttpStatus.OK)
                .bodyJson()
                .extractingPath("$.paths['/api/v1/practice-logs'].get.parameters[*].name")
                .asArray()
                .containsExactly("month");
    }

    // FE는 Swagger 요청·응답 예시를 타입으로 검사하므로(frontend/scripts/swagger-type-examples.mjs),
    // 예시가 빠진 요청·응답 필드가 하나라도 있으면 FE의 예시 생성이 중단된다.
    @Test
    void requestAndResponseFieldsAllHaveExamples() throws Exception {
        MvcTestResult result = mockMvc.get().uri("/v3/api-docs").exchange();
        assertThat(result).hasStatusOk();
        JsonNode docs = objectMapper.readTree(result.getResponse().getContentAsString(UTF_8));
        JsonNode schemas = docs.path("components").path("schemas");
        Set<String> missing = new TreeSet<>();
        for (JsonNode operations : docs.path("paths")) {
            for (JsonNode operation : operations) {
                collectMissingExamples(
                        schemas, operation.path("requestBody").path("content"), missing);
                for (JsonNode response : operation.path("responses")) {
                    collectMissingExamples(schemas, response.path("content"), missing);
                }
            }
        }

        assertThat(missing).isEmpty();
    }

    /** 본문 예시가 없어 FE 예시 생성기가 스키마 필드 예시로 본문을 만드는 경우만 검사한다. */
    private static void collectMissingExamples(
            JsonNode schemas, JsonNode content, Set<String> missing) {
        for (JsonNode media : content) {
            if (media.has("example") || media.has("examples")) {
                continue;
            }
            String ref = media.path("schema").path("$ref").asString("");
            collectMissingExamples(schemas, ref, new HashSet<>(), missing);
        }
    }

    /** FE 예시 생성기와 같은 규칙으로, 예시도 하위 스키마도 enum도 없는 필드를 모은다. */
    private static void collectMissingExamples(
            JsonNode schemas, String ref, Set<String> visited, Set<String> missing) {
        String name = ref.substring(ref.lastIndexOf('/') + 1);
        if (name.isEmpty() || !visited.add(name)) {
            return;
        }
        for (Map.Entry<String, JsonNode> field :
                schemas.path(name).path("properties").properties()) {
            JsonNode property = field.getValue();
            if (property.has("example") || property.has("enum")) {
                continue;
            }
            String nested =
                    property.path("$ref")
                            .asString(property.path("items").path("$ref").asString(""));
            if (nested.isEmpty()) {
                missing.add(name + "." + field.getKey());
            } else {
                collectMissingExamples(schemas, nested, visited, missing);
            }
        }
    }
}
