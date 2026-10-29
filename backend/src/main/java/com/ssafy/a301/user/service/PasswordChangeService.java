package com.ssafy.a301.user.service;

import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.auth.repository.RefreshTokenStore;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.user.domain.PasswordChange;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.dto.UserDtos.PasswordChangeResponse;
import com.ssafy.a301.user.repository.PasswordChangeRepository;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 비밀번호를 바꾸고 기록을 남긴 뒤 그 회원의 모든 기기를 로그아웃한다(리프레시 토큰 전부 폐기). 2.3 회원 변경은 바꾼 기기에 새 토큰을 줘 로그인을 잇고, 9.10
 * 관리자 변경은 주지 않는다. 이미 발급된 액세스 토큰은 만료(auth.access-ttl)까지 그대로 쓸 수 있다.
 */
@Service
public class PasswordChangeService {
    private static final Logger LOG = LoggerFactory.getLogger(PasswordChangeService.class);

    private final UserRepository users;
    private final PasswordChangeRepository changes;
    private final PasswordEncoder passwords;
    private final RefreshTokenStore refreshTokens;
    private final AccessTokens accessTokens;
    private final AuthProperties authProperties;
    private final TransactionTemplate transactions;

    public PasswordChangeService(
            UserRepository users,
            PasswordChangeRepository changes,
            PasswordEncoder passwords,
            RefreshTokenStore refreshTokens,
            AccessTokens accessTokens,
            AuthProperties authProperties,
            TransactionTemplate transactions) {
        this.users = users;
        this.changes = changes;
        this.passwords = passwords;
        this.refreshTokens = refreshTokens;
        this.accessTokens = accessTokens;
        this.authProperties = authProperties;
        this.transactions = transactions;
    }

    /**
     * 2.3. 지금 비밀번호가 틀리면 400 PASSWORD_MISMATCH, 소셜 회원은 409 PASSWORD_NOT_SET. 바꾼 기기가 이어 쓸 새 토큰을 준다
     */
    public PasswordChangeResponse changeByUser(
            long userId, String currentPassword, String newPassword) {
        UserChange change =
                transactions.execute(
                        status -> {
                            User user =
                                    users.findActiveForUpdate(userId)
                                            .orElseThrow(
                                                    () -> new ApiException(ErrorCode.UNAUTHORIZED));
                            requirePassword(user);
                            if (!passwords.matches(currentPassword, user.getPasswordHash())) {
                                throw new ApiException(ErrorCode.PASSWORD_MISMATCH);
                            }
                            user.changePasswordHash(passwords.encode(newPassword));
                            // 잠금을 얻은 뒤의 시각을 쓴다. 리프레시 토큰의 로그인 시각은 밀리초 단위라 같은 단위로 맞춘다
                            OffsetDateTime changedAt =
                                    KoreaTime.now().truncatedTo(ChronoUnit.MILLIS);
                            changes.save(PasswordChange.byUser(userId, changedAt));
                            return new UserChange(user.getNickname(), changedAt);
                        });
        // 먼저 모두 폐기한 뒤 이 기기 토큰을 만든다(반대로 하면 새 토큰도 지워진다)
        revokeAll(userId);
        // 새 토큰의 로그인 시각을 변경 기록 시각과 같게 둬 재발급(1.4)에서 막히지 않게 한다
        return new PasswordChangeResponse(
                accessTokens.issue(userId, change.nickname()),
                refreshTokens.issue(userId, change.changedAt().toInstant()),
                authProperties.accessTtl().toSeconds());
    }

    private record UserChange(String nickname, OffsetDateTime changedAt) {}

    /**
     * 9.10. 관리자가 회원 비밀번호를 바꾼다. 없거나 탈퇴한 회원은 404 USER_NOT_FOUND. 소셜 회원은 비밀번호로 로그인하는 방법이 생기지 않게 409
     * PASSWORD_NOT_SET
     */
    public void changeByAdmin(long userId, long adminId, String newPassword, Long inquiryId) {
        transactions.executeWithoutResult(
                status -> {
                    // 같은 회원의 정보 변경 · 탈퇴와 겹치지 않게 회원 행을 잠근다(BE 설계 3장)
                    User user =
                            users.findActiveForUpdate(userId)
                                    .orElseThrow(() -> new ApiException(ErrorCode.USER_NOT_FOUND));
                    requirePassword(user);
                    user.changePasswordHash(passwords.encode(newPassword));
                    changes.save(
                            PasswordChange.byAdmin(userId, adminId, inquiryId, KoreaTime.now()));
                });
        revokeAll(userId);
    }

    private static void requirePassword(User user) {
        if (!user.hasPassword()) {
            throw new ApiException(ErrorCode.PASSWORD_NOT_SET);
        }
    }

    // 비밀번호는 이미 바뀌었다. 폐기에 실패해도 재발급(1.4)이 변경 기록 시각과 로그인 시각을 비교해 막으므로 기록만 남긴다
    private void revokeAll(long userId) {
        try {
            refreshTokens.revokeAll(userId);
        } catch (DataAccessException ex) {
            LOG.warn("회원 {}의 리프레시 토큰 폐기 실패(비밀번호 변경): {}", userId, ex.getMessage());
        }
    }
}
