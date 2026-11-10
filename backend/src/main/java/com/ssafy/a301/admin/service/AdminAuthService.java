package com.ssafy.a301.admin.service;

import com.ssafy.a301.admin.config.AdminPasswordEncoder;
import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.dto.AdminDtos.AdminTokenResponse;
import com.ssafy.a301.admin.jwt.AdminTokens;
import com.ssafy.a301.admin.mapper.AdminMapper;
import com.ssafy.a301.admin.repository.AdminLoginAttemptStore;
import com.ssafy.a301.admin.repository.AdminRepository;
import com.ssafy.a301.admin.repository.AdminTokenStore;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import java.time.Duration;
import java.time.Instant;
import org.springframework.stereotype.Service;

/** 8.1 · 8.2 관리자 로그인·로그아웃. 토큰은 액세스 토큰 하나이며 재발급은 없다. */
@Service
public class AdminAuthService {
    private final AdminRepository admins;
    private final AdminPasswordEncoder passwords;
    private final AdminTokens tokens;
    private final AdminTokenStore revokedTokens;
    private final AdminLoginAttemptStore loginAttempts;

    public AdminAuthService(
            AdminRepository admins,
            AdminPasswordEncoder passwords,
            AdminTokens tokens,
            AdminTokenStore revokedTokens,
            AdminLoginAttemptStore loginAttempts) {
        this.admins = admins;
        this.passwords = passwords;
        this.tokens = tokens;
        this.revokedTokens = revokedTokens;
        this.loginAttempts = loginAttempts;
    }

    /**
     * 아이디가 없거나 비밀번호가 틀리면 같은 401로 구분하지 않는다. 같은 아이디로 같은 IP에서 5번 연속 틀리면 15분 동안 429 ADMIN_LOGIN_LOCKED다
     * (비밀번호가 맞아도). 없는 아이디도 같게 센다
     */
    public AdminTokenResponse login(String loginId, String password, String clientIp) {
        Duration locked = loginAttempts.tryAcquire(loginId, clientIp);
        if (locked.isPositive()) {
            throw new ApiException(ErrorCode.ADMIN_LOGIN_LOCKED, locked);
        }
        Admin admin =
                admins.findByLoginIdAndDeletedAtIsNull(loginId)
                        .filter(a -> passwords.matches(password, a.getPasswordHash()))
                        .orElseThrow(() -> new ApiException(ErrorCode.ADMIN_LOGIN_FAILED));
        loginAttempts.reset(loginId, clientIp);
        return new AdminTokenResponse(
                tokens.issue(admin.getId(), admin.getName()),
                tokens.ttlSeconds(),
                AdminMapper.toSummary(admin));
    }

    /** 이 토큰을 만료 시각까지 쓸 수 없게 한다. */
    public void logout(String token, Instant expiresAt) {
        revokedTokens.revoke(token, expiresAt);
    }
}
