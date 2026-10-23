package com.ssafy.a301.admin.repository;

import java.time.Instant;

/** 로그아웃(8.2)한 관리자 토큰. 만료 시각까지 남겨 그 전에도 쓸 수 없게 한다. */
public interface AdminTokenStore {
    void revoke(String token, Instant expiresAt);

    boolean isRevoked(String token);
}
