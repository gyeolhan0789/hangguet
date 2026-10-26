package com.ssafy.a301.user.service;

import com.ssafy.a301.auth.repository.RefreshTokenStore;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.PasswordChange;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.PasswordChangeRepository;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 비밀번호를 바꾸고 기록을 남긴 뒤 그 회원의 모든 기기를 로그아웃한다(리프레시 토큰 전부 폐기). 9.10 관리자 변경에서 쓰고, 회원 직접 변경도 이 흐름을 쓸 예정이다.
 * 액세스 토큰은 만료(auth.access-ttl)까지 그대로 쓸 수 있다.
 */
@Service
public class PasswordChangeService {
    private static final Logger LOG = LoggerFactory.getLogger(PasswordChangeService.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final UserRepository users;
    private final PasswordChangeRepository changes;
    private final PasswordEncoder passwords;
    private final RefreshTokenStore refreshTokens;
    private final TransactionTemplate transactions;

    public PasswordChangeService(
            UserRepository users,
            PasswordChangeRepository changes,
            PasswordEncoder passwords,
            RefreshTokenStore refreshTokens,
            TransactionTemplate transactions) {
        this.users = users;
        this.changes = changes;
        this.passwords = passwords;
        this.refreshTokens = refreshTokens;
        this.transactions = transactions;
    }

    /** 관리자가 회원 비밀번호를 바꾼다. 없거나 탈퇴한 회원은 404 USER_NOT_FOUND */
    public void changeByAdmin(long userId, long adminId, String newPassword, Long inquiryId) {
        transactions.executeWithoutResult(
                status -> {
                    // 같은 회원의 정보 변경 · 탈퇴와 겹치지 않게 회원 행을 잠근다(BE 설계 3장)
                    User user =
                            users.findActiveForUpdate(userId)
                                    .orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND));
                    user.changePasswordHash(passwords.encode(newPassword));
                    changes.save(
                            PasswordChange.byAdmin(
                                    userId, adminId, inquiryId, OffsetDateTime.now(KST)));
                });
        // 비밀번호는 이미 바뀌었다. 폐기에 실패해도 재발급(1.4)이 변경 기록 시각과 로그인 시각을 비교해 막으므로 기록만 남긴다
        try {
            refreshTokens.revokeAll(userId);
        } catch (DataAccessException ex) {
            LOG.warn("회원 {}의 리프레시 토큰 폐기 실패(비밀번호 변경): {}", userId, ex.getMessage());
        }
    }
}
