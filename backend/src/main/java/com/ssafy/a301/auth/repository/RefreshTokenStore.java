package com.ssafy.a301.auth.repository;

public interface RefreshTokenStore {
    String issue(long userId);

    Long consume(String token);

    void revoke(String token, long userId);
}
