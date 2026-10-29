package com.ssafy.a301.auth.oauth;

import com.ssafy.a301.user.domain.SocialProvider;

/** 제공자 하나. 인가 코드로 제공자 토큰을 받아 회원 정보를 읽는다 */
public interface SocialLoginClient {
    SocialProvider provider();

    /**
     * 등록하지 않은 redirectUri는 400 VALIDATION_FAILED, 쓸 수 없는 코드는 401 SOCIAL_LOGIN_FAILED, 키가 없거나 제공자 서버
     * 오류·시간 초과는 503 SOCIAL_LOGIN_UNAVAILABLE
     */
    SocialProfile fetchProfile(String code, String redirectUri);
}
