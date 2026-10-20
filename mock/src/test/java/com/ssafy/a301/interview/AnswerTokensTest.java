package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Collections;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

/** 답변 제출(5.7)의 음성 인식 토큰(tokens) 규칙을 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
class AnswerTokensTest {

    private static final String IDEMPOTENCY_KEY = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    private static final String VOICE =
            "\"inputType\": \"VOICE\", \"content\": \"저는 그\", \"audioObjectKey\":"
                    + " \"sessions/55/answers/303.webm\"";
    private static final String TEXT = "\"inputType\": \"TEXT\", \"content\": \"저는 그\"";
    private static final String TOKEN = "{ \"text\": \"저는\", \"startMs\": 0, \"endMs\": 320 }";

    @Autowired private MockMvcTester mockMvc;

    @Test
    void voiceWithoutTokensIsAccepted() {
        assertThat(submit("{ " + VOICE + " }")).hasStatus(HttpStatus.ACCEPTED);
    }

    @Test
    void voiceWithTokensIsAccepted() {
        String tokens =
                "[ "
                        + TOKEN
                        + ", { \"text\": \" \", \"startMs\": 320, \"endMs\": 320 },"
                        + " { \"text\": \"그\", \"startMs\": 320, \"endMs\": 520 } ]";
        assertThat(submit("{ " + VOICE + ", \"tokens\": " + tokens + " }"))
                .hasStatus(HttpStatus.ACCEPTED);
    }

    @Test
    void textWithTokensIsRejected() {
        assertRejected("{ " + TEXT + ", \"tokens\": [ " + TOKEN + " ] }", "tokens");
    }

    @Test
    void textWithEmptyTokensIsRejected() {
        assertRejected("{ " + TEXT + ", \"tokens\": [] }", "tokens");
    }

    @Test
    void endBeforeStartIsRejected() {
        String tokens = "[ " + TOKEN + ", { \"text\": \"그\", \"startMs\": 520, \"endMs\": 519 } ]";
        assertRejected("{ " + VOICE + ", \"tokens\": " + tokens + " }", "tokens[1].endMs");
    }

    @Test
    void emptyTextIsRejected() {
        String tokens = "[ { \"text\": \"\", \"startMs\": 0, \"endMs\": 320 } ]";
        assertRejected("{ " + VOICE + ", \"tokens\": " + tokens + " }", "tokens[0].text");
    }

    @Test
    void negativeStartIsRejected() {
        String tokens = "[ { \"text\": \"저는\", \"startMs\": -1, \"endMs\": 320 } ]";
        assertRejected("{ " + VOICE + ", \"tokens\": " + tokens + " }", "tokens[0].startMs");
    }

    @Test
    void missingEndIsRejected() {
        String tokens = "[ { \"text\": \"저는\", \"startMs\": 0 } ]";
        assertRejected("{ " + VOICE + ", \"tokens\": " + tokens + " }", "tokens[0].endMs");
    }

    @Test
    void nullTokenIsRejected() {
        assertRejected("{ " + VOICE + ", \"tokens\": [ null ] }", "tokens[0]");
    }

    @Test
    void moreThan10000TokensIsRejected() {
        String tokens = "[ " + String.join(", ", Collections.nCopies(10_001, TOKEN)) + " ]";
        assertRejected("{ " + VOICE + ", \"tokens\": " + tokens + " }", "tokens");
    }

    private void assertRejected(String body, String field) {
        assertThat(submit(body))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo(field);
    }

    private MvcTestResult submit(String body) {
        return mockMvc.post()
                .uri("/api/v1/interview-sessions/55/questions/303/answer")
                .header("Idempotency-Key", IDEMPOTENCY_KEY)
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .exchange();
    }
}
