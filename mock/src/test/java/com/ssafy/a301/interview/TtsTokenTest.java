package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;

import com.ssafy.a301.common.error.ErrorCode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

/** 질문 음성 토큰(5.12)이 서버 설정 키로 발급되고 오류를 반환하며, Swagger 문서에 명세대로 나오는지 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = "elevenlabs.api-key=")
class TtsTokenTest {

    private static final String PATH =
            "$.paths['/api/v1/interview-sessions/{sessionId}/questions/{questionId}/tts-token'].post";

    @Autowired private MockMvcTester mockMvc;

    @Test
    void withoutServerKeyIsTtsUnavailable() {
        assertThat(mockMvc.post().uri("/api/v1/interview-sessions/55/questions/303/tts-token"))
                .hasStatus(503)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("TTS_UNAVAILABLE");
    }

    @Test
    void sessionIdZeroIsNotFound() {
        assertThat(mockMvc.post().uri("/api/v1/interview-sessions/0/questions/303/tts-token"))
                .hasStatus(404)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("SESSION_NOT_FOUND");
    }

    @Test
    void questionIdZeroIsNotFound() {
        assertThat(mockMvc.post().uri("/api/v1/interview-sessions/55/questions/0/tts-token"))
                .hasStatus(404)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("QUESTION_NOT_FOUND");
    }

    @Test
    void ttsUnavailableIs503() {
        assertThat(ErrorCode.TTS_UNAVAILABLE.status()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }

    @Test
    void docsListResponsesInSpec() {
        assertThat(mockMvc.get().uri("/v3/api-docs"))
                .bodyJson()
                .satisfies(
                        json -> {
                            assertThat(json)
                                    .extractingPath(PATH + ".responses")
                                    .asMap()
                                    .containsOnlyKeys("200", "404", "409", "503");
                            assertThat(json)
                                    .extractingPath(
                                            PATH
                                                    + ".responses['409'].content['application/problem+json'].examples")
                                    .asMap()
                                    .containsOnlyKeys("INVALID_SESSION_STATE");
                            assertThat(json)
                                    .extractingPath("$.paths.*.*.summary")
                                    .asArray()
                                    .containsSequence("5.11 면접관 리액션", "5.12 질문 음성 토큰");
                        });
    }
}
