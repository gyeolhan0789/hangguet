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

class KakaoLoginClientTest {
    private static final String REDIRECT = "https://a301/oauth/kakao/callback";
    private static final OAuthProperties.Kakao KEYS =
            new OAuthProperties.Kakao("rest-key", "secret", List.of(REDIRECT));
    private MockRestServiceServer kakao;
    private KakaoLoginClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        kakao = MockRestServiceServer.bindTo(builder).build();
        client = new KakaoLoginClient(builder.build(), KEYS);
    }

    @Test
    void codeIsExchangedAndVerifiedEmailIsRead() {
        kakao.expect(requestTo(KakaoLoginClient.TOKEN_URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(
                        content()
                                .formDataContains(
                                        Map.of(
                                                "grant_type", "authorization_code",
                                                "client_id", "rest-key",
                                                "client_secret", "secret",
                                                "redirect_uri", REDIRECT,
                                                "code", "code")))
                .andRespond(json("{\"access_token\":\"kakao-access\",\"token_type\":\"bearer\"}"));
        kakao.expect(requestTo(KakaoLoginClient.PROFILE_URL))
                .andExpect(header("Authorization", "Bearer kakao-access"))
                .andRespond(
                        json(
                                "{\"id\":12345,\"kakao_account\":{\"email\":\"k@kakao.com\","
                                        + "\"is_email_valid\":true,\"is_email_verified\":true,"
                                        + "\"profile\":{\"nickname\":\"카카오\"}}}"));

        SocialProfile profile = client.fetchProfile("code", REDIRECT);

        assertThat(profile)
                .isEqualTo(new SocialProfile(SocialProvider.KAKAO, "12345", "k@kakao.com", "카카오"));
        kakao.verify();
    }

    @Test
    void unverifiedOrMissingEmailIsLeftOut() {
        kakao.expect(requestTo(KakaoLoginClient.TOKEN_URL))
                .andRespond(json("{\"access_token\":\"kakao-access\"}"));
        kakao.expect(requestTo(KakaoLoginClient.PROFILE_URL))
                .andRespond(
                        json(
                                "{\"id\":1,\"kakao_account\":{\"email\":\"k@kakao.com\","
                                        + "\"is_email_valid\":true,\"is_email_verified\":false}}"));

        SocialProfile profile = client.fetchProfile("code", REDIRECT);

        assertThat(profile.email()).isNull();
        assertThat(profile.nickname()).isNull();
    }

    @Test
    void rejectedCodeIsLoginFailureAndServerErrorIsUnavailable() {
        kakao.expect(requestTo(KakaoLoginClient.TOKEN_URL))
                .andRespond(
                        withStatus(HttpStatus.BAD_REQUEST)
                                .contentType(MediaType.APPLICATION_JSON)
                                .body("{\"error\":\"invalid_grant\",\"error_code\":\"KOE320\"}"));
        assertCode(() -> client.fetchProfile("used", REDIRECT), ErrorCode.SOCIAL_LOGIN_FAILED);

        kakao.reset();
        kakao.expect(requestTo(KakaoLoginClient.TOKEN_URL)).andRespond(withServerError());
        assertCode(() -> client.fetchProfile("code", REDIRECT), ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
    }

    @Test
    void unregisteredRedirectUriIsRejectedBeforeCallingKakao() {
        assertThatThrownBy(() -> client.fetchProfile("code", "https://evil/callback"))
                .isInstanceOf(FieldValidationException.class);
        kakao.verify();
    }

    @Test
    void missingKeyIsUnavailable() {
        var unconfigured =
                new KakaoLoginClient(
                        RestClient.create(), new OAuthProperties.Kakao(null, null, null));
        assertCode(
                () -> unconfigured.fetchProfile("code", REDIRECT),
                ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
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
