package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

/** 면접방(LiveKit) 연동 뒤의 5.4 응답, 5.14 입장 토큰, 채팅 전용 5.7과 없어진 API를 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
class InterviewRoomTest {
    private static final String IDEMPOTENCY_KEY = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    @Autowired private MockMvcTester mockMvc;

    @Test
    void startGivesRoomWithoutQuestion() {
        var result =
                mockMvc.post()
                        .uri("/api/v1/interview-sessions/55/start")
                        .header("Idempotency-Key", IDEMPOTENCY_KEY);

        assertThat(result).hasStatusOk();
        assertThat(result)
                .bodyJson()
                .extractingPath("$.room.url")
                .isEqualTo("wss://rtc.hangguet.co.kr");
        assertThat(result).bodyJson().extractingPath("$.room.token").isNotNull();
        assertThat(result).bodyJson().extractingPath("$.currentQuestion").isNull();
    }

    @Test
    void roomTokenIsIssuedAgain() {
        assertThat(mockMvc.post().uri("/api/v1/interview-sessions/55/room-token"))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.expiresAt")
                .isNotNull();
        assertThat(mockMvc.post().uri("/api/v1/interview-sessions/0/room-token"))
                .hasStatus(HttpStatus.NOT_FOUND)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("SESSION_NOT_FOUND");
    }

    @Test
    void answerIsChatOnly() {
        assertThat(answer("{ \"inputType\": \"TEXT\", \"content\": \"캐시를 직접 설계했습니다.\" }"))
                .hasStatus(HttpStatus.ACCEPTED);
        assertThat(answer("{ \"inputType\": \"VOICE\", \"content\": \"저는 그\" }"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo("inputType");
        assertThat(
                        answer(
                                "{ \"inputType\": \"TEXT\", \"content\": \""
                                        + "가".repeat(1_001)
                                        + "\" }"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo("content");
    }

    @Test
    void replacedApisAreGone() {
        for (String uri :
                new String[] {
                    "/api/v1/interview-sessions/55/stt-token",
                    "/api/v1/interview-sessions/55/questions/303/tts-token",
                    "/api/v1/interview-sessions/55/questions/303/reactions",
                    "/api/v1/interview-sessions/55/questions/303/answer-audio/upload-url",
                    "/api/v1/interview-sessions/55/recordings/upload-url",
                    "/api/v1/interview-sessions/55/recordings"
                }) {
            assertThat(
                            mockMvc.post()
                                    .uri(uri)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{}"))
                    .as(uri)
                    .hasStatus(HttpStatus.NOT_FOUND);
        }
    }

    private org.springframework.test.web.servlet.assertj.MvcTestResult answer(String body) {
        return mockMvc.post()
                .uri("/api/v1/interview-sessions/55/questions/303/answer")
                .header("Idempotency-Key", IDEMPOTENCY_KEY)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .exchange();
    }
}
