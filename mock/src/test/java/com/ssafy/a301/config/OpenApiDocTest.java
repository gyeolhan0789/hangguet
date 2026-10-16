package com.ssafy.a301.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

/** OpenAPI 문서가 생성되고 공통 오류 스키마가 들어 있는지 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
class OpenApiDocTest {

    @Autowired private MockMvcTester mockMvc;

    @Test
    void apiDocsHasProblemDetailSchema() {
        assertThat(mockMvc.get().uri("/v3/api-docs"))
                .hasStatus(HttpStatus.OK)
                .bodyJson()
                .extractingPath("$.components.schemas.ProblemDetail.properties.code.type")
                .isEqualTo("string");
    }
}
