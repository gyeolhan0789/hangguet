package com.ssafy.a301.user.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.Locale;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * 회원. 이메일은 탈퇴하지 않은 회원끼리만 중복 불가(부분 UNIQUE 인덱스 uk_users_email_active). 저장할 때 소문자로 바꾸고, 가입 · 로그인은
 * 대소문자를 구분하지 않고 찾으므로(ix_users_email_lower) 대소문자만 다른 이메일로 새로 가입할 수 없다. 소셜 회원(1.7)은 비밀번호가 없다.
 */
@Entity
@Table(name = "users")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 255)
    private String email;

    // 소셜 회원은 null
    @Column(name = "password_hash", length = 255)
    private String passwordHash;

    @Column(nullable = false, length = 50)
    private String nickname;

    @Column(name = "profile_image_key", length = 500)
    private String profileImageKey;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    // 마지막 비밀번호 변경 시각(2.3 · 9.10). 이보다 먼저 발급한 액세스 토큰은 받지 않는다. 바꾼 적 없으면 null
    @Column(name = "password_changed_at")
    private OffsetDateTime passwordChangedAt;

    public User(String email, String passwordHash, String nickname) {
        this.email = normalizeEmail(email);
        this.passwordHash = passwordHash;
        this.nickname = nickname;
    }

    /** 소셜 로그인(1.7)으로 가입한 회원. 비밀번호가 없어 이메일 로그인(1.3)·비밀번호 변경(2.3·9.10)을 할 수 없다 */
    public static User social(String email, String nickname) {
        return new User(email, null, nickname);
    }

    /** 이메일 비교·저장 기준. 앞뒤 공백을 지우고 소문자로 바꾼다 */
    public static String normalizeEmail(String email) {
        return email.strip().toLowerCase(Locale.ROOT);
    }

    public void changeNickname(String nickname) {
        this.nickname = nickname;
    }

    public void changePassword(String passwordHash, OffsetDateTime changedAt) {
        this.passwordHash = passwordHash;
        this.passwordChangedAt = changedAt;
    }

    public void changeProfileImage(String profileImageKey) {
        this.profileImageKey = profileImageKey;
    }

    public void withdraw(OffsetDateTime now) {
        this.deletedAt = now;
    }

    public boolean hasPassword() {
        return passwordHash != null;
    }

    public boolean isWithdrawn() {
        return deletedAt != null;
    }
}
