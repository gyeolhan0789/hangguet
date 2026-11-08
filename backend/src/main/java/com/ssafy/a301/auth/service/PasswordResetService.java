package com.ssafy.a301.auth.service;

import com.ssafy.a301.auth.repository.PasswordResetTokenStore;
import com.ssafy.a301.auth.repository.PasswordResetTokenStore.ResetToken;
import com.ssafy.a301.auth.reset.PasswordResetMailer;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.service.PasswordChangeService;
import org.springframework.stereotype.Service;

/** 비밀번호 찾기. 메일 링크(1.8)로 받은 토큰으로 새 비밀번호를 정한다(1.9) */
@Service
public class PasswordResetService {
    private final UserRepository users;
    private final PasswordResetTokenStore tokens;
    private final PasswordResetMailer mailer;
    private final PasswordChangeService passwordChanges;

    public PasswordResetService(
            UserRepository users,
            PasswordResetTokenStore tokens,
            PasswordResetMailer mailer,
            PasswordChangeService passwordChanges) {
        this.users = users;
        this.tokens = tokens;
        this.mailer = mailer;
        this.passwordChanges = passwordChanges;
    }

    /**
     * 1.8. 가입 여부를 드러내지 않도록 결과를 돌려주지 않는다(항상 204). 이메일 회원에게만 링크를 보내고, 없는 이메일 · 소셜 회원 · 재요청 간격 안의 요청은
     * 보내지 않는다
     */
    public void request(String email) {
        String normalized = User.normalizeEmail(email);
        if (!tokens.tryStartResendInterval(normalized)) {
            return;
        }
        // 대소문자만 다른 예전 계정이 둘 이상이면 계정마다 링크를 보낸다
        users.findActiveByEmail(normalized).stream()
                .filter(User::hasPassword)
                .forEach(user -> mailer.send(user.getEmail(), tokens.issue(user.getId())));
    }

    /** 1.9. 없거나 만료됐거나 이미 쓴 토큰은 400 PASSWORD_RESET_TOKEN_INVALID */
    public void confirm(String token, String newPassword) {
        ResetToken reset = tokens.consume(token);
        if (reset == null) {
            throw new ApiException(ErrorCode.PASSWORD_RESET_TOKEN_INVALID);
        }
        passwordChanges.changeByReset(reset.userId(), newPassword, reset.issuedAt());
    }
}
