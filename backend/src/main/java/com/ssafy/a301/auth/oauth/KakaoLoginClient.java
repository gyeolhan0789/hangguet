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

/** 카카오 로그인 REST API. 인가 코드 → 카카오 토큰 → 사용자 정보. 카카오 토큰은 저장하지 않는다 */
@Component
public class KakaoLoginClient implements SocialLoginClient {
    static final String TOKEN_URL = "https://kauth.kakao.com/oauth/token";
    static final String PROFILE_URL = "https://kapi.kakao.com/v2/user/me";
    private static final int EMAIL_MAX = 255;
    private static final Logger LOG = LoggerFactory.getLogger(KakaoLoginClient.class);
    private final RestClient http;
    private final OAuthProperties.Client properties;

    @Autowired
    public KakaoLoginClient(OAuthProperties properties) {
        this(OAuthHttp.restClient(properties), properties.kakao());
    }

    KakaoLoginClient(RestClient http, OAuthProperties.Client properties) {
        this.http = http;
        this.properties = properties;
    }

    @Override
    public SocialProvider provider() {
        return SocialProvider.KAKAO;
    }

    @Override
    public SocialProfile fetchProfile(String code, String redirectUri) {
        if (!properties.hasClientId()) {
            LOG.warn("카카오 로그인 키(KAKAO_CLIENT_ID)가 없어 로그인할 수 없음");
            throw new ApiException(ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
        }
        if (!properties.redirectUris().contains(redirectUri)) {
            throw new FieldValidationException("redirectUri", "등록되지 않은 주소입니다.");
        }
        KakaoUser user =
                OAuthHttp.call(SocialProvider.KAKAO, () -> userOf(accessToken(code, redirectUri)));
        if (user == null || user.id() == null) {
            throw new ApiException(ErrorCode.SOCIAL_LOGIN_FAILED);
        }
        KakaoAccount account = user.account();
        return new SocialProfile(
                SocialProvider.KAKAO,
                user.id().toString(),
                account == null ? null : account.confirmedEmail(),
                account == null || account.profile() == null ? null : account.profile().nickname());
    }

    private String accessToken(String code, String redirectUri) {
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "authorization_code");
        form.add("client_id", properties.clientId());
        form.add("redirect_uri", redirectUri);
        form.add("code", code);
        if (properties.hasClientSecret()) {
            form.add("client_secret", properties.clientSecret());
        }
        KakaoToken token =
                http.post()
                        .uri(TOKEN_URL)
                        .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                        .body(form)
                        .retrieve()
                        .body(KakaoToken.class);
        if (token == null || token.accessToken() == null) {
            throw new ApiException(ErrorCode.SOCIAL_LOGIN_FAILED);
        }
        return token.accessToken();
    }

    private KakaoUser userOf(String accessToken) {
        return http.get()
                .uri(PROFILE_URL)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                .retrieve()
                .body(KakaoUser.class);
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record KakaoToken(@JsonProperty("access_token") String accessToken) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record KakaoUser(Long id, @JsonProperty("kakao_account") KakaoAccount account) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record KakaoAccount(
            String email,
            @JsonProperty("is_email_valid") Boolean emailValid,
            @JsonProperty("is_email_verified") Boolean emailVerified,
            KakaoProfile profile) {
        // 유효하고 인증된 이메일만 쓴다. users.email(255자)에 들어가지 않으면 없는 것으로 본다
        String confirmedEmail() {
            boolean confirmed =
                    Boolean.TRUE.equals(emailValid) && Boolean.TRUE.equals(emailVerified);
            boolean usable = email != null && !email.isBlank() && email.length() <= EMAIL_MAX;
            return confirmed && usable ? email : null;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    record KakaoProfile(String nickname) {}
}
