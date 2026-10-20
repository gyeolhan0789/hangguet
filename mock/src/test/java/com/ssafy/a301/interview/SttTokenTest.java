package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

@SpringBootTest
@AutoConfigureMockMvc
class SttTokenTest {

    @Autowired private MockMvcTester mockMvc;

    @Test
    void withoutSonioxApiKeyIsValidationFailed() {
        assertThat(mockMvc.post().uri("/api/v1/interview-sessions/55/stt-token"))
                .hasStatus(400)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("VALIDATION_FAILED");
    }
}
