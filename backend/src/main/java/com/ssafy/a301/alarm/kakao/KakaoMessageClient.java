package com.ssafy.a301.alarm.kakao;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.ssafy.a301.alarm.kakao.KakaoApiException.Kind;
import com.ssafy.a301.auth.oauth.OAuthHttp;
import com.ssafy.a301.auth.oauth.OAuthProperties;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 카카오톡 연습 알림에 쓰는 카카오 API. 알림을 켤 때 받은 인가 코드를 토큰으로 바꾸고 메시지 동의(talk_message)를 확인하며, 저장한 토큰으로 "나에게
 * 보내기"를 한다. 앱 키는 카카오 로그인과 같다(oauth.kakao)
 */
@Component
public class KakaoMessageClient {
    static final String TOKEN_URL = "https://kauth.kakao.com/oauth/token";
    static final String SCOPES_URL = "https://kapi.kakao.com/v2/user/scopes";
    static final String SEND_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";
    static final String MESSAGE_SCOPE = "talk_message";
    private static final String BUTTON_TITLE = "연습하러 가기";
    private static final String INVALID_GRANT = "invalid_grant";
    // 카카오 API 오류 코드: 동의하지 않은 항목(-402), 앱과 연결되지 않은 회원(-101)
    private static final String INSUFFICIENT_SCOPE = "-402";
    private static final String NOT_REGISTERED_USER = "-101";
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Logger LOG = LoggerFactory.getLogger(KakaoMessageClient.class);
    private final RestClient http;
    private final OAuthProperties.Client properties;

    @Autowired
    public KakaoMessageClient(OAuthProperties properties) {
        this(OAuthHttp.restClient(properties), properties.kakao());
    }

    KakaoMessageClient(RestClient http, OAuthProperties.Client properties) {
        this.http = http;
        this.properties = properties;
    }

    /** 카카오 로그인 키가 있으면 true. 없으면 알림을 켜거나 보낼 수 없다 */
    public boolean isConfigured() {
        return properties.hasClientId();
    }

    /** 등록한 redirectUri인지. 로그인(1.6)과 같은 콜백 주소를 쓴다 */
    public boolean isAllowedRedirectUri(String redirectUri) {
        return properties.redirectUris().contains(redirectUri);
    }

    /** 메시지 링크. 첫 번째 redirectUri의 주소(https://도메인)이며 카카오 앱 플랫폼(Web)에 등록한 도메인이어야 열린다 */
    public String linkUrl() {
        List<String> uris = properties.redirectUris();
        if (uris.isEmpty()) {
            return null;
        }
        URI uri = URI.create(uris.get(0));
        return uri.getScheme() + "://" + uri.getRawAuthority();
    }

    /** 인가 코드 → 토큰 */
    public KakaoToken exchange(String code, String redirectUri) {
        var form = clientForm();
        form.add("grant_type", "authorization_code");
        form.add("redirect_uri", redirectUri);
        form.add("code", code);
        return token(form);
    }

    /** 리프레시 토큰 → 새 액세스 토큰. 리프레시 토큰은 1개월 미만으로 남았을 때만 새로 온다(아니면 null) */
    public KakaoToken refresh(String refreshToken) {
        var form = clientForm();
        form.add("grant_type", "refresh_token");
        form.add("refresh_token", refreshToken);
        return token(form);
    }

    /** 이 토큰의 카카오 회원 번호와 메시지 전송 동의 여부 */
    public KakaoConsent consent(String accessToken) {
        Scopes scopes =
                api(
                        () ->
                                http.get()
                                        .uri(SCOPES_URL)
                                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                                        .retrieve()
                                        .body(Scopes.class));
        if (scopes == null || scopes.id() == null) {
            throw new KakaoApiException(Kind.UNAVAILABLE, "카카오 동의 항목 응답에 회원 번호가 없음");
        }
        boolean agreed =
                scopes.scopes() != null
                        && scopes.scopes().stream()
                                .anyMatch(
                                        scope ->
                                                MESSAGE_SCOPE.equals(scope.id())
                                                        && Boolean.TRUE.equals(scope.agreed()));
        return new KakaoConsent(scopes.id().toString(), agreed);
    }

    /** 나에게 보내기(텍스트 템플릿). 버튼은 linkUrl()로 연다 */
    public void sendToMe(String accessToken, String text) {
        String link = linkUrl();
        if (link == null) {
            throw new KakaoApiException(Kind.UNAVAILABLE, "메시지 링크로 쓸 KAKAO_REDIRECT_URIS가 없음");
        }
        var form = new LinkedMultiValueMap<String, String>();
        form.add(
                "template_object",
                JSON.writeValueAsString(
                        Map.of(
                                "object_type",
                                "text",
                                "text",
                                text,
                                "link",
                                Map.of("web_url", link, "mobile_web_url", link),
                                "button_title",
                                BUTTON_TITLE)));
        api(
                () ->
                        http.post()
                                .uri(SEND_URL)
                                .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                                .body(form)
                                .retrieve()
                                .toBodilessEntity());
    }

    private MultiValueMap<String, String> clientForm() {
        if (!isConfigured()) {
            LOG.warn("카카오 키(KAKAO_CLIENT_ID)가 없어 연습 알림을 쓸 수 없음");
            throw new KakaoApiException(Kind.UNAVAILABLE, "카카오 키 없음");
        }
        var form = new LinkedMultiValueMap<String, String>();
        form.add("client_id", properties.clientId());
        if (properties.hasClientSecret()) {
            form.add("client_secret", properties.clientSecret());
        }
        return form;
    }

    // 토큰 받기: invalid_grant만 쓸 수 없는 코드 · 리프레시 토큰(다시 동의해야 함)으로 본다. 401(앱 키) · 그 밖의 4xx(요청 형식)는 우리 설정
    // ·
    // 코드 문제라 회원 알림을 끄지 않는다
    private KakaoToken token(MultiValueMap<String, String> form) {
        KakaoToken token;
        try {
            token =
                    http.post()
                            .uri(TOKEN_URL)
                            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                            .body(form)
                            .retrieve()
                            .body(KakaoToken.class);
        } catch (RestClientResponseException ex) {
            int status = ex.getStatusCode().value();
            if (status == HttpStatus.UNAUTHORIZED.value()) {
                LOG.error("카카오 앱 키 오류 {}: {}", status, ex.getResponseBodyAsString());
                throw new KakaoApiException(Kind.UNAVAILABLE, "카카오 앱 키 오류");
            }
            if (INVALID_GRANT.equals(field(ex, "error"))) {
                throw new KakaoApiException(
                        Kind.REJECTED, "카카오 토큰 거절: " + ex.getResponseBodyAsString());
            }
            if (ex.getStatusCode().is4xxClientError()) {
                LOG.error("카카오 토큰 요청 오류 {}: {}", status, ex.getResponseBodyAsString());
            }
            throw new KakaoApiException(Kind.UNAVAILABLE, "카카오 토큰 실패 " + status);
        } catch (RestClientException ex) {
            throw new KakaoApiException(Kind.UNAVAILABLE, "카카오 호출 실패: " + ex.getMessage());
        }
        if (token == null
                || token.accessToken() == null
                || token.expiresIn() == null
                || token.expiresIn() <= 0) {
            throw new KakaoApiException(Kind.UNAVAILABLE, "카카오 토큰 응답이 올바르지 않음");
        }
        return token;
    }

    // 카카오 API: 401은 액세스 토큰 만료. 동의 철회(-402) · 앱 연결 끊김(-101)만 다시 동의해야 하는 것으로 본다. 그 밖의 4xx(앱 권한 -3,
    // 템플릿 · 링크 도메인 등록 등)는 우리 설정 문제라 회원 알림을 끄지 않고 오류로 남긴다
    private <T> T api(Supplier<T> request) {
        try {
            return request.get();
        } catch (RestClientResponseException ex) {
            int status = ex.getStatusCode().value();
            if (status == HttpStatus.UNAUTHORIZED.value()) {
                throw new KakaoApiException(Kind.TOKEN_EXPIRED, "카카오 액세스 토큰 만료");
            }
            String code = field(ex, "code");
            if (INSUFFICIENT_SCOPE.equals(code) || NOT_REGISTERED_USER.equals(code)) {
                throw new KakaoApiException(
                        Kind.REJECTED, "카카오 동의 없음: " + ex.getResponseBodyAsString());
            }
            if (ex.getStatusCode().is4xxClientError()) {
                LOG.error("카카오 API 요청 오류 {}: {}", status, ex.getResponseBodyAsString());
            }
            throw new KakaoApiException(Kind.UNAVAILABLE, "카카오 API 실패 " + status);
        } catch (RestClientException ex) {
            throw new KakaoApiException(Kind.UNAVAILABLE, "카카오 호출 실패: " + ex.getMessage());
        }
    }

    // 카카오 오류 응답(JSON)의 값. 읽을 수 없으면 null
    private static String field(RestClientResponseException ex, String name) {
        try {
            JsonNode value = JSON.readTree(ex.getResponseBodyAsString()).get(name);
            return value == null || value.isNull() ? null : value.asString();
        } catch (JacksonException unreadable) {
            return null;
        }
    }

    /** 카카오 토큰. 갱신(refresh)에서는 refreshToken · refreshTokenExpiresIn이 null일 수 있다 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record KakaoToken(
            @JsonProperty("access_token") String accessToken,
            @JsonProperty("expires_in") Long expiresIn,
            @JsonProperty("refresh_token") String refreshToken,
            @JsonProperty("refresh_token_expires_in") Long refreshTokenExpiresIn) {}

    /** kakaoUserId: 카카오 회원 번호(user_social_accounts.provider_user_id와 비교) */
    public record KakaoConsent(String kakaoUserId, boolean messageAgreed) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Scopes(Long id, List<Scope> scopes) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record Scope(String id, Boolean agreed) {}
}
