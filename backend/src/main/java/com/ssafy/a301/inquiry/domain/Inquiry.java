package com.ssafy.a301.inquiry.domain;

import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.inquiry.crypto.EncryptedTextConverter;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 문의. id가 문의번호다. 회원 문의는 user, 비회원 문의는 accessPasswordHash(조회 비밀번호 해시)가 있다. 제목은 암호화해 저장한다.
 *
 * <p>상태: 만들면 WAITING. 문의한 사람이 쓰면 WAITING, 관리자가 쓰면 ANSWERED. 누구든 종료하면 CLOSED가 되고 더 쓸 수 없다(409
 * INQUIRY_CLOSED). updatedAt은 마지막으로 질문 · 답변이 달리거나 종료한 일시다.
 */
@Entity
@Table(name = "inquiries")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Inquiry {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "user_id")
    private User user;

    @Column(nullable = false, length = 255)
    private String email;

    @Convert(converter = EncryptedTextConverter.class)
    @Column(nullable = false, columnDefinition = "TEXT")
    private String title;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private InquiryStatus status;

    @Column(name = "access_password_hash", length = 255)
    private String accessPasswordHash;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    private Inquiry(
            User user, String email, String title, String accessPasswordHash, OffsetDateTime now) {
        this.user = user;
        this.email = email;
        this.title = title;
        this.accessPasswordHash = accessPasswordHash;
        this.status = InquiryStatus.WAITING;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /** 회원 문의. 이메일은 그 회원의 이메일을 남긴다 */
    public static Inquiry ofMember(User user, String title, OffsetDateTime now) {
        return new Inquiry(user, user.getEmail(), title, null, now);
    }

    /** 비회원 문의. 조회 비밀번호는 해시로만 남긴다 */
    public static Inquiry ofGuest(
            String email, String title, String accessPasswordHash, OffsetDateTime now) {
        return new Inquiry(null, email, title, accessPasswordHash, now);
    }

    public boolean isGuest() {
        return user == null;
    }

    /** 문의한 사람이 질문을 하나 더 단다. 상태는 답변 대기 */
    public InquiryMessage addQuestion(String content, OffsetDateTime now) {
        writable();
        status = InquiryStatus.WAITING;
        updatedAt = now;
        return InquiryMessage.question(this, content, now);
    }

    /** 관리자가 답변한다. 상태는 답변함 */
    public InquiryMessage addAnswer(Admin admin, String content, OffsetDateTime now) {
        writable();
        status = InquiryStatus.ANSWERED;
        updatedAt = now;
        return InquiryMessage.answer(this, admin, content, now);
    }

    /** 종료한다. 이미 종료했으면 그대로 둔다 */
    public void close(OffsetDateTime now) {
        if (status == InquiryStatus.CLOSED) {
            return;
        }
        status = InquiryStatus.CLOSED;
        updatedAt = now;
    }

    private void writable() {
        if (status == InquiryStatus.CLOSED) {
            throw new ApiException(ErrorCode.INQUIRY_CLOSED);
        }
    }
}
