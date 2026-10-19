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

    private MvcTestResult post(String uri, String body) {
        return mockMvc.post()
                .uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .exchange();
    }
}
