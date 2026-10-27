package com.ssafy.a301.common.error;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

/** Spring 자체 오류도 ProblemDetail + code 형식으로 나가는지 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
class ErrorResponseTest {

    @Autowired private MockMvcTester mockMvc;

    @Test
    void unknownPathHasCode() {
        assertThat(mockMvc.get().uri("/api/v1/unknown"))
                .hasStatus(HttpStatus.NOT_FOUND)
                .hasContentType(MediaType.APPLICATION_PROBLEM_JSON)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("NOT_FOUND");
    }

    @Test
    void springDetailIsReplacedWithUserMessage() {
        assertThat(mockMvc.get().uri("/api/v1/unknown"))
                .bodyJson()
                .extractingPath("$.detail")
                .isEqualTo("요청한 주소를 찾을 수 없어요.");
    }

    @Test
    void unsupportedMethodHasCode() {
        assertThat(mockMvc.delete().uri("/actuator/health"))
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("METHOD_NOT_ALLOWED");
    }
}
