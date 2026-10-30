package com.ssafy.a301.auth.oauth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.user.domain.SocialProvider;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.client.ResponseCreator;
import org.springframework.web.client.RestClient;

class GoogleLoginClientTest {
    private static final String REDIRECT = "https://a301/oauth/google/callback";
    private static final OAuthProperties.Client KEYS =
            new OAuthProperties.Client("client-id", "secret", List.of(REDIRECT));
    private MockRestServiceServer google;
    private GoogleLoginClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        google = MockRestServiceServer.bindTo(builder).build();
        client = new GoogleLoginClient(builder.build(), KEYS);
    }

    @Test
    void codeIsExchangedAndVerifiedEmailIsRead() {
        google.expect(requestTo(GoogleLoginClient.TOKEN_URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(
                        content()
                                .formDataContains(
                                        Map.of(
                                                "grant_type", "authorization_code",
                                                "client_id", "client-id",
                                                "client_secret", "secret",
                                                "redirect_uri", REDIRECT,
                                                "code", "code")))
                .andRespond(
                        json(
                                "{\"access_token\":\"google-access\",\"id_token\":\"jwt\","
                                        + "\"token_type\":\"Bearer\"}"));
        google.expect(requestTo(GoogleLoginClient.PROFILE_URL))
                .andExpect(header("Authorization", "Bearer google-access"))
                .andRespond(
                        json(
                                "{\"sub\":\"1098765\",\"email\":\"g@gmail.com\","
                                        + "\"email_verified\":true,\"name\":\"구글\"}"));

        SocialProfile profile = client.fetchProfile("code", REDIRECT);

        assertThat(profile)
                .isEqualTo(
                        new SocialProfile(SocialProvider.GOOGLE, "1098765", "g@gmail.com", "구글"));
        google.verify();
    }

    @Test
    void unverifiedOrMissingEmailIsLeftOut() {
        google.expect(requestTo(GoogleLoginClient.TOKEN_URL))
                .andRespond(json("{\"access_token\":\"google-access\"}"));
        google.expect(requestTo(GoogleLoginClient.PROFILE_URL))
                .andRespond(
                        json(
                                "{\"sub\":\"1\",\"email\":\"g@gmail.com\","
                                        + "\"email_verified\":false}"));

        SocialProfile profile = client.fetchProfile("code", REDIRECT);

        assertThat(profile.email()).isNull();
        assertThat(profile.nickname()).isNull();
    }

    @Test
    void rejectedCodeIsLoginFailureAndServerErrorIsUnavailable() {
        google.expect(requestTo(GoogleLoginClient.TOKEN_URL))
                .andRespond(
                        withStatus(HttpStatus.BAD_REQUEST)
                                .contentType(MediaType.APPLICATION_JSON)
                                .body("{\"error\":\"invalid_grant\"}"));
        assertCode(() -> client.fetchProfile("used", REDIRECT), ErrorCode.SOCIAL_LOGIN_FAILED);

        google.reset();
        google.expect(requestTo(GoogleLoginClient.TOKEN_URL)).andRespond(withServerError());
        assertCode(() -> client.fetchProfile("code", REDIRECT), ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);

        // 우리 앱 키가 틀렸으면 사용자가 다시 로그인해도 소용없다
        google.reset();
        google.expect(requestTo(GoogleLoginClient.TOKEN_URL))
                .andRespond(
                        withStatus(HttpStatus.UNAUTHORIZED)
                                .contentType(MediaType.APPLICATION_JSON)
                                .body("{\"error\":\"invalid_client\"}"));
        assertCode(() -> client.fetchProfile("code", REDIRECT), ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
    }

    @Test
    void missingSubjectIsLoginFailure() {
        google.expect(requestTo(GoogleLoginClient.TOKEN_URL))
                .andRespond(json("{\"access_token\":\"google-access\"}"));
        google.expect(requestTo(GoogleLoginClient.PROFILE_URL))
                .andRespond(json("{\"email\":\"g@gmail.com\",\"email_verified\":true}"));

        assertCode(() -> client.fetchProfile("code", REDIRECT), ErrorCode.SOCIAL_LOGIN_FAILED);
    }

    @Test
    void unregisteredRedirectUriIsRejectedBeforeCallingGoogle() {
        assertThatThrownBy(() -> client.fetchProfile("code", "https://evil/callback"))
                .isInstanceOf(FieldValidationException.class);
        google.verify();
    }

    @Test
    void missingIdOrSecretIsUnavailable() {
        for (var keys :
                List.of(
                        new OAuthProperties.Client(null, "secret", List.of(REDIRECT)),
                        new OAuthProperties.Client("client-id", null, List.of(REDIRECT)))) {
            var unconfigured = new GoogleLoginClient(RestClient.create(), keys);
            assertCode(
                    () -> unconfigured.fetchProfile("code", REDIRECT),
                    ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
        }
    }

    private static ResponseCreator json(String body) {
        return withSuccess(body, MediaType.APPLICATION_JSON);
    }

    private static void assertCode(Runnable call, ErrorCode code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.errorCode()).isEqualTo(code));
    }
}
