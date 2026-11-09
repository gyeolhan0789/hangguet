package com.ssafy.a301.user.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 비밀번호 변경 기록. 비밀번호 값은 남기지 않는다. 관리자 · 문의는 다른 기능의 테이블이라 id만 둔다(외래키는 DDL에 있음). */
@Entity
@Table(name = "password_changes")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PasswordChange {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "changed_by", nullable = false, length = 20)
    private PasswordChangedBy changedBy;

    // 바꿔 준 관리자. 회원이 직접 바꿨으면 없음
    @Column(name = "admin_id")
    private Long adminId;

    // 요청이 들어온 문의. 문의 없이 바꿨으면 없음
    @Column(name = "inquiry_id")
    private Long inquiryId;

    @Column(name = "changed_at", nullable = false)
    private OffsetDateTime changedAt;

    private PasswordChange(
            long userId,
            PasswordChangedBy changedBy,
            Long adminId,
            Long inquiryId,
            OffsetDateTime changedAt) {
        this.userId = userId;
        this.changedBy = changedBy;
        this.adminId = adminId;
        this.inquiryId = inquiryId;
        this.changedAt = changedAt;
    }

    public static PasswordChange byAdmin(
            long userId, long adminId, Long inquiryId, OffsetDateTime changedAt) {
        return new PasswordChange(userId, PasswordChangedBy.ADMIN, adminId, inquiryId, changedAt);
    }

    public static PasswordChange byUser(long userId, OffsetDateTime changedAt) {
        return new PasswordChange(userId, PasswordChangedBy.USER, null, null, changedAt);
    }

    public static PasswordChange byReset(long userId, OffsetDateTime changedAt) {
        return new PasswordChange(userId, PasswordChangedBy.RESET, null, null, changedAt);
    }
}
