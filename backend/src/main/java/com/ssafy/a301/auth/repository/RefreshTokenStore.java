package com.ssafy.a301.auth.repository;

public interface RefreshTokenStore {
    String issue(long userId);

    Long consume(String token);

    void revoke(String token, long userId);

    /** 회원의 모든 기기 리프레시 토큰을 폐기한다(탈퇴). */
    void revokeAll(long userId);
}
