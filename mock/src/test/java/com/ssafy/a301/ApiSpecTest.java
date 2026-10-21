package com.ssafy.a301;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

/** API 명세의 문서 구성, 응답 형식, 오류 케이스가 명세대로 나오는지 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
class ApiSpecTest {

    private static final String IDEMPOTENCY_KEY = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    @Autowired private MockMvcTester mockMvc;

    @Test
    void docsListAll38ApisInSpecNumberOrder() {
        assertThat(mockMvc.get().uri("/v3/api-docs"))
                .bodyJson()
                .extractingPath("$.paths.*.*.summary")
                .asArray()
                .hasSize(38)
                .startsWith("1.1 이메일 사용 가능 여부")
                .endsWith("7.2 최근 성장 리뷰");
    }

    @Test
    void homeReturnsExample() {
        assertThat(mockMvc.get().uri("/api/v1/home"))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.homeState")
                .isEqualTo("NOT_DONE_TODAY");
    }

    @Test
    void dateTimeHasKoreanOffset() {
        assertThat(mockMvc.get().uri("/api/v1/users/me"))
                .bodyJson()
                .extractingPath("$.createdAt")
                .isEqualTo("2026-09-01T10:00:00+09:00");
    }

    @Test
    void pageListUsesPagedModelFormat() {
        assertThat(mockMvc.get().uri("/api/v1/applications"))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.page.number")
                .isEqualTo(0);
    }

    @Test
    void signupWithAllAgreementsSucceeds() {
        String body =
                """
                { "email": "a@ssafy.com", "password": "abcd1234", "nickname": "면접왕",
                  "agreements": [ { "termsType": "TERMS", "termsVersion": "1.0" },
                                  { "termsType": "PRIVACY", "termsVersion": "1.0" },
                                  { "termsType": "RECORDING", "termsVersion": "1.0" } ] }\
                """;
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .hasStatus(HttpStatus.CREATED);
    }

    @Test
    void signupWithWrongAgreementCountIsInvalid() {
        String body =
                """
                { "email": "a@ssafy.com", "password": "abcd1234", "nickname": "면접왕",
                  "agreements": [ { "termsType": "TERMS", "termsVersion": "1.0" },
                                  { "termsType": "PRIVACY", "termsVersion": "1.0" } ] }\
                """;
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void signupWithNullAgreementIsInvalid() {
        String body =
                """
                { "email": "a@ssafy.com", "password": "abcd1234", "nickname": "면접왕",
                  "agreements": [ { "termsType": "TERMS", "termsVersion": "1.0" },
                                  { "termsType": "PRIVACY", "termsVersion": "1.0" },
                                  null ] }\
                """;
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void signupWithoutAllAgreementsIsRejected() {
        String body =
                """
                { "email": "a@ssafy.com", "password": "abcd1234", "nickname": "면접왕",
                  "agreements": [ { "termsType": "TERMS", "termsVersion": "1.0" },
                                  { "termsType": "TERMS", "termsVersion": "1.0" },
                                  { "termsType": "PRIVACY", "termsVersion": "1.0" } ] }\
                """;
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("AGREEMENT_REQUIRED");
    }

    @Test
    void invalidFieldsReturnErrors() {
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        { "email": "bad", "password": "abcd1234", "nickname": "면접왕",
                                          "agreements": [] }\
                                        """))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[*].field")
                .asArray()
                .contains("email", "agreements");
    }

    @Test
    void missingIdempotencyKeyIsRejected() {
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/interview-sessions")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        """
                                        { "applicationId": 10, "persona": "DEVIL", "mode": "VIDEO" }\
                                        """))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo("Idempotency-Key");
    }

    @Test
    void sessionIdZeroReturnsNotFound() {
        assertThat(mockMvc.get().uri("/api/v1/interview-sessions/0"))
                .hasStatus(HttpStatus.NOT_FOUND)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("SESSION_NOT_FOUND");
    }

    @Test
    void chatAnswerLongerThan1000IsRejected() {
        String content = "가".repeat(1001);
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/interview-sessions/55/questions/303/answer")
                                .header("Idempotency-Key", IDEMPOTENCY_KEY)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{ \"inputType\": \"TEXT\", \"content\": \""
                                                + content
                                                + "\" }"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo("content");
    }

    @Test
    void pageSizeOverLimitIsRejected() {
        assertThat(mockMvc.get().uri("/api/v1/growth-reviews?size=50"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo("size");
    }

    @Test
    void tooLongWithdrawalPasswordIsRejected() {
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/users/me")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{ \"password\": \"" + "a1".repeat(32) + "b\" }"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo("password");
    }

    @Test
    void withdrawIsPost() {
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/users/me")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{ \"password\": \"abcd1234\" }"))
                .hasStatus(HttpStatus.NO_CONTENT);
    }
}
