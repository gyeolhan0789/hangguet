package com.ssafy.a301.auth.oauth;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.user.domain.SocialProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;

/** 구글 로그인(OpenID Connect). 인가 코드 → 구글 토큰 → 사용자 정보. 구글 토큰은 저장하지 않는다 */
@Component
public class GoogleLoginClient implements SocialLoginClient {
    static final String TOKEN_URL = "https://oauth2.googleapis.com/token";
    static final String PROFILE_URL = "https://openidconnect.googleapis.com/v1/userinfo";
    private static final int EMAIL_MAX = 255;
    private static final Logger LOG = LoggerFactory.getLogger(GoogleLoginClient.class);
    private final RestClient http;
    private final OAuthProperties.Client properties;

    @Autowired
    public GoogleLoginClient(OAuthProperties properties) {
        this(OAuthHttp.restClient(properties), properties.google());
    }

    GoogleLoginClient(RestClient http, OAuthProperties.Client properties) {
        this.http = http;
        this.properties = properties;
    }

    @Override
    public SocialProvider provider() {
        return SocialProvider.GOOGLE;
    }

    @Override
    public SocialProfile fetchProfile(String code, String redirectUri) {
        // 구글 웹 앱은 클라이언트 보안 비밀번호가 반드시 있어야 토큰을 준다
        if (!properties.hasClientId() || !properties.hasClientSecret()) {
            LOG.warn("구글 로그인 키(GOOGLE_CLIENT_ID · GOOGLE_CLIENT_SECRET)가 없어 로그인할 수 없음");
            throw new ApiException(ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
        }
        if (!properties.redirectUris().contains(redirectUri)) {
            throw new FieldValidationException("redirectUri", "등록되지 않은 주소입니다.");
        }
        GoogleUser user =
                OAuthHttp.call(SocialProvider.GOOGLE, () -> userOf(accessToken(code, redirectUri)));
        if (user == null || user.sub() == null || user.sub().isBlank()) {
            throw new ApiException(ErrorCode.SOCIAL_LOGIN_FAILED);
        }
        return new SocialProfile(
                SocialProvider.GOOGLE, user.sub(), user.confirmedEmail(), user.name());
    }

    private String accessToken(String code, String redirectUri) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", properties.clientId());
        form.add("client_secret", properties.clientSecret());
        form.add("redirect_uri", redirectUri);
        form.add("code", code);
        GoogleToken token =
                http.post()
                        .uri(TOKEN_URL)
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .body(GoogleToken.class);
        if (token == null || token.accessToken() == null) {
            throw new ApiException(ErrorCode.SOCIAL_LOGIN_FAILED);
        }
        return token.accessToken();
    }

    private GoogleUser userOf(String accessToken) {
        return http.get()
                .uri(PROFILE_URL)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                .retrieve()
                .body(GoogleUser.class);
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record GoogleToken(@JsonProperty("access_token") String accessToken) {}

    /** sub: 구글 회원 번호. email · name은 화면이 email · profile scope를 요청해야 온다 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record GoogleUser(
            String sub,
            String email,
            @JsonProperty("email_verified") Boolean emailVerified,
            String name) {
        // 구글이 확인한 이메일만 쓴다. users.email(255자)에 들어가지 않으면 없는 것으로 본다
        String confirmedEmail() {
            boolean usable = email != null && !email.isBlank() && email.length() <= EMAIL_MAX;
            return Boolean.TRUE.equals(emailVerified) && usable ? email : null;
        }
    }
}
