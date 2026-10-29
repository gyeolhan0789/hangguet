package com.ssafy.a301.auth.repository;

import com.ssafy.a301.auth.oauth.SocialProfile;

/** 처음 소셜 로그인한 사람이 약관에 동의(1.7)할 때까지 제공자가 알려 준 회원 정보를 맡아 둔다. 인가 코드는 한 번만 쓸 수 있어서다 */
public interface SocialSignupStore {

    /** 가입 토큰(1.6 signupToken)을 만든다 */
    String issue(SocialProfile profile);

    /** 맡겨 둔 회원 정보. 없거나 만료됐거나 가입에 이미 썼으면 null */
    SocialProfile find(String token);

    /** 가입에 성공한 뒤 지운다(1.7) */
    void delete(String token);
}
