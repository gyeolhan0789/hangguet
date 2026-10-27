package com.ssafy.a301.auth.repository;

import java.time.Instant;

public interface RefreshTokenStore {

    /**
     * 리프레시 토큰 하나. authenticatedAt은 비밀번호로 로그인(가입)한 시각으로, 재발급해도 이어진다. 이 시각 뒤에 비밀번호를 바꿨으면 재발급하지 않는다.
     */
    record RefreshSession(long userId, Instant authenticatedAt) {}

    /** 로그인·가입. 지금을 로그인 시각으로 남긴다 */
    default String issue(long userId) {
        return issue(userId, Instant.now());
    }

    /** 재발급. 이전 토큰의 로그인 시각을 그대로 잇는다 */
    String issue(long userId, Instant authenticatedAt);

    /** 토큰을 한 번만 쓰고 지운다. 없거나 이미 썼으면 null */
    RefreshSession consume(String token);

    void revoke(String token, long userId);

    /** 회원의 모든 기기 리프레시 토큰을 폐기한다(탈퇴·비밀번호 변경). */
    void revokeAll(long userId);
}
