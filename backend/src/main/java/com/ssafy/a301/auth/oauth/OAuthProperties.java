package com.ssafy.a301.auth.oauth;

import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** 소셜 로그인(1.6 · 1.7). 제공자 키는 환경 변수로만 받는다. 클라이언트 id가 없으면 그 제공자 로그인은 503으로 답한다 */
@ConfigurationProperties("oauth")
public record OAuthProperties(Duration signupTokenTtl, Duration timeout, Kakao kakao) {
    public OAuthProperties {
        if (signupTokenTtl == null
                || signupTokenTtl.isNegative()
                || signupTokenTtl.isZero()
                || timeout == null
                || timeout.isNegative()
                || timeout.isZero()) {
            throw new IllegalArgumentException(
                    "OAuth signup token TTL and timeout must be positive");
        }
        if (kakao == null) {
            kakao = new Kakao(null, null, null);
        }
    }

    /** redirectUris: 받을 수 있는 redirectUri. 카카오 앱에 등록한 주소와 같아야 한다 */
    public record Kakao(String clientId, String clientSecret, List<String> redirectUris) {
        public Kakao {
            redirectUris = redirectUris == null ? List.of() : List.copyOf(redirectUris);
        }

        public boolean isConfigured() {
            return clientId != null && !clientId.isBlank();
        }
    }
}
