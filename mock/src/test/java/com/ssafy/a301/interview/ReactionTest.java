package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

/** 면접관 리액션(5.11)이 예시 응답과 오류를 돌려주는지 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
class ReactionTest {

    private static final String URI = "/api/v1/interview-sessions/55/questions/303/reactions";
    private static final String PATH =
            "$.paths['/api/v1/interview-sessions/{sessionId}/questions/{questionId}/reactions'].post";
    private static final String BODY =
            "{ \"seq\": 3, \"text\": \"그래서 조회 응답 시간을 40% 줄였습니다.\", \"pauseMs\": 420 }";

    @Autowired private MockMvcTester mockMvc;

    @Test
    void returnsReaction() {
        assertThat(post("/api/v1/interview-sessions/55/questions/303/reactions", BODY))
                .hasStatusOk()
                .bodyJson()
                .satisfies(
                        json -> {
                            assertThat(json).extractingPath("$.reaction.gesture").isEqualTo("nod");
                            assertThat(json).extractingPath("$.attitude.interest").isEqualTo(0.7);
                            assertThat(json).extractingPath("$.interrupt").isNull();
                        });
    }

    @Test
    void questionIdZeroIsNotFound() {
        assertThat(post("/api/v1/interview-sessions/55/questions/0/reactions", BODY))
                .hasStatus(404)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("QUESTION_NOT_FOUND");
    }

    @Test
    void blankTextIsRejected() {
        assertThat(
                        post(
                                "/api/v1/interview-sessions/55/questions/303/reactions",
                                "{ \"seq\": 3, \"text\": \" \", \"pauseMs\": 420 }"))
                .hasStatus(400)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void textUpTo1000IsAccepted() {
        assertThat(post(URI, body("가".repeat(1000)))).hasStatusOk();
    }

    @Test
    void textOver1000IsRejected() {
        assertThat(post(URI, body("가".repeat(1001))))
                .hasStatus(400)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo("text");
    }

    @Test
    void docsListVideoAndChatRequestExamples() {
        assertThat(mockMvc.get().uri("/v3/api-docs"))
                .bodyJson()
                .extractingPath(PATH + ".requestBody.content['application/json'].examples")
                .asMap()
                .containsOnlyKeys("S06 화상", "S06-B 채팅");
    }

    private static String body(String text) {
        return "{ \"seq\": 7, \"text\": \"" + text + "\", \"pauseMs\": 800 }";
    }

    private MvcTestResult post(String uri, String body) {
        return mockMvc.post()
                .uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .exchange();
    }
}
