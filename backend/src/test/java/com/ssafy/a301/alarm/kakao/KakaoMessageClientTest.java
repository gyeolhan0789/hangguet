package com.ssafy.a301.alarm.kakao;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.ssafy.a301.alarm.kakao.KakaoApiException.Kind;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient.KakaoConsent;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient.KakaoToken;
import com.ssafy.a301.auth.oauth.OAuthProperties;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.client.ResponseCreator;
import org.springframework.web.client.RestClient;

class KakaoMessageClientTest {
    private static final String REDIRECT = "https://a301.example.com/oauth/kakao/callback";
    private static final OAuthProperties.Client KEYS =
            new OAuthProperties.Client(
                    "rest-key",
                    "secret",
                    List.of(REDIRECT, "http://localhost:3000/oauth/kakao/callback"));
    private MockRestServiceServer kakao;
    private KakaoMessageClient client;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder();
        kakao = MockRestServiceServer.bindTo(builder).build();
        client = new KakaoMessageClient(builder.build(), KEYS);
    }

    @Test
    void codeIsExchangedForTokens() {
        kakao.expect(requestTo(KakaoMessageClient.TOKEN_URL))
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
                .andRespond(
                        json(
                                "{\"access_token\":\"access\",\"expires_in\":21599,"
                                        + "\"refresh_token\":\"refresh\","
                                        + "\"refresh_token_expires_in\":5183999,"
                                        + "\"scope\":\"talk_message\"}"));

        assertThat(client.exchange("code", REDIRECT))
                .isEqualTo(new KakaoToken("access", 21599L, "refresh", 5183999L));
        kakao.verify();
    }

    @Test
    void refreshMayNotReturnNewRefreshToken() {
        kakao.expect(requestTo(KakaoMessageClient.TOKEN_URL))
                .andExpect(
                        content()
                                .formDataContains(
                                        Map.of(
                                                "grant_type", "refresh_token",
                                                "client_id", "rest-key",
                                                "refresh_token", "refresh")))
                .andRespond(json("{\"access_token\":\"new-access\",\"expires_in\":21599}"));

        assertThat(client.refresh("refresh"))
                .isEqualTo(new KakaoToken("new-access", 21599L, null, null));
    }

    @Test
    void consentHasKakaoUserIdAndMessageAgreement() {
        kakao.expect(requestTo(KakaoMessageClient.SCOPES_URL))
                .andExpect(header("Authorization", "Bearer access"))
                .andRespond(
                        json(
                                "{\"id\":12345,\"scopes\":[{\"id\":\"profile_nickname\","
                                        + "\"agreed\":true},{\"id\":\"talk_message\","
                                        + "\"agreed\":true}]}"));
        assertThat(client.consent("access")).isEqualTo(new KakaoConsent("12345", true));

        kakao.reset();
        kakao.expect(requestTo(KakaoMessageClient.SCOPES_URL))
                .andRespond(
                        json(
                                "{\"id\":12345,\"scopes\":[{\"id\":\"talk_message\",\"agreed\":false}]}"));
        assertThat(client.consent("access").messageAgreed()).isFalse();
    }

    @Test
    void textMessageLinksToFirstRedirectOrigin() {
        kakao.expect(requestTo(KakaoMessageClient.SEND_URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer access"))
                .andExpect(
                        request -> {
                            String body =
                                    URLDecoder.decode(
                                            ((MockClientHttpRequest) request)
                                                    .getBodyAsString(StandardCharsets.UTF_8),
                                            StandardCharsets.UTF_8);
                            assertThat(body)
                                    .contains("\"object_type\":\"text\"")
                                    .contains("\"text\":\"오늘 연습해요\"")
                                    .contains("\"web_url\":\"https://a301.example.com\"")
                                    .contains("\"button_title\":\"연습하러 가기\"");
                        })
                .andRespond(json("{\"result_code\":0}"));

        client.sendToMe("access", "오늘 연습해요");

        kakao.verify();
        assertThat(client.linkUrl()).isEqualTo("https://a301.example.com");
    }

    @Test
    void failuresAreClassified() {
        // 인가 코드 · 리프레시 토큰을 쓸 수 없다
        expectToken(
                HttpStatus.BAD_REQUEST, "{\"error\":\"invalid_grant\",\"error_code\":\"KOE322\"}");
        assertKind(() -> client.refresh("refresh"), Kind.REJECTED);

        // 우리 앱 키 · 요청 형식이 틀렸으면 회원이 다시 동의해도 소용없다(알림을 끄지 않는다)
        expectToken(HttpStatus.UNAUTHORIZED, "{\"error\":\"invalid_client\"}");
        assertKind(() -> client.refresh("refresh"), Kind.UNAVAILABLE);
        expectToken(HttpStatus.BAD_REQUEST, "{\"error\":\"invalid_request\"}");
        assertKind(() -> client.refresh("refresh"), Kind.UNAVAILABLE);

        expectSend(
                HttpStatus.UNAUTHORIZED,
                "{\"msg\":\"this access token does not exist\",\"code\":-401}");
        assertKind(() -> client.sendToMe("access", "text"), Kind.TOKEN_EXPIRED);

        // 동의 철회 · 앱 연결 끊김
        expectSend(HttpStatus.FORBIDDEN, "{\"msg\":\"insufficient scopes.\",\"code\":-402}");
        assertKind(() -> client.sendToMe("access", "text"), Kind.REJECTED);
        expectSend(
                HttpStatus.BAD_REQUEST, "{\"msg\":\"NotRegisteredUserException\",\"code\":-101}");
        assertKind(() -> client.sendToMe("access", "text"), Kind.REJECTED);

        // 앱 권한 · 링크 도메인 등 우리 설정 문제
        expectSend(HttpStatus.FORBIDDEN, "{\"msg\":\"App disabled\",\"code\":-3}");
        assertKind(() -> client.sendToMe("access", "text"), Kind.UNAVAILABLE);
        expectSend(HttpStatus.BAD_REQUEST, "not json");
        assertKind(() -> client.sendToMe("access", "text"), Kind.UNAVAILABLE);

        kakao.reset();
        kakao.expect(requestTo(KakaoMessageClient.SEND_URL)).andRespond(withServerError());
        assertKind(() -> client.sendToMe("access", "text"), Kind.UNAVAILABLE);
    }

    private void expectToken(HttpStatus status, String body) {
        kakao.reset();
        kakao.expect(requestTo(KakaoMessageClient.TOKEN_URL))
                .andRespond(withStatus(status).contentType(MediaType.APPLICATION_JSON).body(body));
    }

    private void expectSend(HttpStatus status, String body) {
        kakao.reset();
        kakao.expect(requestTo(KakaoMessageClient.SEND_URL))
                .andRespond(withStatus(status).contentType(MediaType.APPLICATION_JSON).body(body));
    }

    @Test
    void missingKeyOrRedirectIsUnavailable() {
        var unconfigured =
                new KakaoMessageClient(
                        RestClient.create(), new OAuthProperties.Client(null, null, null));

        assertThat(unconfigured.isConfigured()).isFalse();
        assertThat(unconfigured.linkUrl()).isNull();
        assertKind(() -> unconfigured.exchange("code", REDIRECT), Kind.UNAVAILABLE);
        assertKind(() -> unconfigured.sendToMe("access", "text"), Kind.UNAVAILABLE);
    }

    private static ResponseCreator json(String body) {
        return withSuccess(body, MediaType.APPLICATION_JSON);
    }

    private static void assertKind(Runnable call, Kind kind) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        KakaoApiException.class, ex -> assertThat(ex.kind()).isEqualTo(kind));
    }
}
