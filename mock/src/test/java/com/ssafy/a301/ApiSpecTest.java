package com.ssafy.a301;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

/** API 명세의 문서 구성, 응답 형식, 오류 케이스가 명세대로 나오는지 확인한다. */
@SpringBootTest
@AutoConfigureMockMvc
class ApiSpecTest {

    private static final String IDEMPOTENCY_KEY = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    @Autowired private MockMvcTester mockMvc;

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
    void socialLoginCodeChoosesResult() {
        assertThat(socialLogin("kakao", "signup"))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.signup.expiresIn")
                .isEqualTo(600);
        assertThat(socialLogin("kakao", "anything"))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.token.user.email")
                .isEqualTo("a@kakao.com");
        assertThat(socialLogin("kakao", "no-email"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("SOCIAL_EMAIL_REQUIRED");
        assertThat(socialLogin("kakao", "duplicated")).hasStatus(HttpStatus.CONFLICT);
        assertThat(socialLogin("google", "signup"))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.signupRequired")
                .isEqualTo(true);
        assertThat(socialLogin("naver", "signup"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo("provider");
    }

    @Test
    void socialSignupNeedsValidTokenAndAllAgreements() {
        String body =
                """
                { "signupToken": "%s",
                  "agreements": [ { "termsType": "TERMS", "termsVersion": "1.0" },
                                  { "termsType": "PRIVACY", "termsVersion": "1.0" },
                                  { "termsType": "RECORDING", "termsVersion": "1.0" } ] }\
                """;
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/auth/oauth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body.formatted("token")))
                .hasStatus(HttpStatus.CREATED);
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/auth/oauth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(body.formatted("expired")))
                .hasStatus(HttpStatus.UNAUTHORIZED)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("SIGNUP_TOKEN_INVALID");
    }

    private MvcTestResult socialLogin(String provider, String code) {
        return mockMvc.post()
                .uri("/api/v1/auth/oauth/" + provider)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        "{ \"code\": \"%s\", \"redirectUri\": \"http://localhost:3000/cb\" }"
                                .formatted(code))
                .exchange();
    }

    @Test
    void practiceAlarmCodeChoosesResultAndTimeIsValidated() {
        assertThat(enablePracticeAlarm("anything"))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.enabled")
                .isEqualTo(true);
        assertThat(enablePracticeAlarm("mismatch"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("KAKAO_ACCOUNT_MISMATCH");
        assertThat(enablePracticeAlarm("not-kakao")).hasStatus(HttpStatus.CONFLICT);
        assertThat(practiceAlarmTime("22:30"))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.time")
                .isEqualTo("22:30");
        assertThat(practiceAlarmTime("24:00")).hasStatus(HttpStatus.BAD_REQUEST);
    }

    @Test
    void socialLinkCodeChoosesResultAndOnlyKakaoIsSupported() {
        assertThat(linkSocialAccount("kakao", "anything"))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.linkedProvider")
                .isEqualTo("KAKAO");
        assertThat(linkSocialAccount("kakao", "in-use"))
                .hasStatus(HttpStatus.CONFLICT)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("SOCIAL_ACCOUNT_IN_USE");
        assertThat(linkSocialAccount("google", "anything")).hasStatus(HttpStatus.BAD_REQUEST);
        assertThat(mockMvc.delete().uri("/api/v1/users/me/social-accounts/kakao").exchange())
                .hasStatus(HttpStatus.NO_CONTENT);
    }

    private MvcTestResult linkSocialAccount(String provider, String code) {
        return mockMvc.put()
                .uri("/api/v1/users/me/social-accounts/" + provider)
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        "{ \"code\": \"%s\", \"redirectUri\": \"http://localhost:3000/cb\" }"
                                .formatted(code))
                .exchange();
    }

    private MvcTestResult enablePracticeAlarm(String code) {
        return mockMvc.put()
                .uri("/api/v1/users/me/practice-alarm")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        "{ \"code\": \"%s\", \"redirectUri\": \"http://localhost:3000/cb\" }"
                                .formatted(code))
                .exchange();
    }

    private MvcTestResult practiceAlarmTime(String time) {
        return mockMvc.patch()
                .uri("/api/v1/users/me/practice-alarm")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{ \"time\": \"%s\" }".formatted(time))
                .exchange();
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
    void whitespaceOnlyCoverLetterQuestionIsRejected() {
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/applications")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{ \"companyName\": \"○○전자\", \"jobTitle\": \"백엔드 개발자\","
                                            + " \"coverLetterItems\": [ { \"question\": \"   \","
                                            + " \"answer\": \"답변\" } ] }"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo("coverLetterItems[0].question");
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

    @Test
    void inquiryPhotoUploadUrlsMatchRequestedCountAndStubKeysFail() {
        assertThat(
                        mockMvc.post()
                                .uri("/api/v1/inquiries/attachments/upload-url")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        "{ \"files\": [ { \"contentType\": \"image/png\","
                                                + " \"size\": 10 }, { \"contentType\":"
                                                + " \"image/jpeg\", \"size\": 10 } ] }"))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.files.length()")
                .isEqualTo(2);
        assertThat(inquiryWithPhoto("inquiry/used.png"))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.errors[0].field")
                .isEqualTo("attachmentKeys");
        assertThat(inquiryWithPhoto("inquiry/missing.png"))
                .hasStatus(HttpStatus.NOT_FOUND)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("FILE_NOT_FOUND");
        assertThat(inquiryWithPhoto("inquiry/7f3c.png"))
                .hasStatus(HttpStatus.CREATED)
                .bodyJson()
                .extractingPath("$.messages[0].attachments.length()")
                .isEqualTo(1);
    }

    private MockMvcTester.MockMvcRequestBuilder inquiryWithPhoto(String key) {
        return mockMvc.post()
                .uri("/api/v1/inquiries")
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        ("{ \"title\": \"사진 문의\", \"content\": \"내용\", \"email\":"
                                        + " \"a@ssafy.com\", \"accessPassword\": \"1234\","
                                        + " \"attachmentKeys\": [ \"%s\" ] }")
                                .formatted(key));
    }
}
