package com.ssafy.a301.auth.oauth;

import com.ssafy.a301.user.domain.SocialProvider;

/** 제공자가 알려 준 회원. email은 제공자가 확인한 이메일만 담고 없으면 null. nickname은 동의하지 않았으면 null */
public record SocialProfile(
        SocialProvider provider, String providerUserId, String email, String nickname) {}
