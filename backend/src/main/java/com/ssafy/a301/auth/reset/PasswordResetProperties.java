package com.ssafy.a301.auth.reset;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** 비밀번호 찾기(1.8 · 1.9). mailFrom이 비어 있으면 메일을 보내지 않는다(로컬 개발) */
@ConfigurationProperties("password-reset")
public record PasswordResetProperties(
        Duration tokenTtl, Duration resendInterval, String linkUrl, String mailFrom) {
    public PasswordResetProperties {
        if (tokenTtl == null
                || tokenTtl.isNegative()
                || tokenTtl.isZero()
                || resendInterval == null
                || resendInterval.isNegative()
                || resendInterval.isZero()) {
            throw new IllegalArgumentException(
                    "Password reset token TTL and resend interval must be positive");
        }
        if (linkUrl == null || linkUrl.isBlank()) {
            throw new IllegalArgumentException("PASSWORD_RESET_URL must not be blank");
        }
    }

    public boolean canSendMail() {
        return mailFrom != null && !mailFrom.isBlank();
    }
}
