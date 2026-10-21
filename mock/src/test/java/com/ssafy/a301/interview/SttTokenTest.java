package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

/** 실시간 음성 인식 토큰(5.10)이 요청 헤더가 아니라 서버 설정 키로 발급되는지 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "soniox.api-key=")
class SttTokenTest {

    @Autowired private MockMvcTester mockMvc;

    @Test
    void withoutServerKeyIsSttUnavailable() {
        assertThat(mockMvc.post().uri("/api/v1/interview-sessions/55/stt-token"))
                .hasStatus(503)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("STT_UNAVAILABLE");
    }

    @Test
    void sessionIdZeroIsNotFound() {
        assertThat(mockMvc.post().uri("/api/v1/interview-sessions/0/stt-token"))
                .hasStatus(404)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("SESSION_NOT_FOUND");
    }
}
