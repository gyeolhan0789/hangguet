package com.ssafy.a301.inquiry.domain;

import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.inquiry.crypto.EncryptedTextConverter;
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

/** 문의 메시지. 한 행이 질문(USER) 또는 답변(ADMIN) 하나. 본문은 암호화해 저장한다. Inquiry.addQuestion · addAnswer로만 만든다. */
@Entity
@Table(name = "inquiry_messages")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class InquiryMessage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "inquiry_id", nullable = false)
    private Inquiry inquiry;

    @Enumerated(EnumType.STRING)
    @Column(name = "author_type", nullable = false, length = 20)
    private AuthorType authorType;

    // 답변한 관리자. 질문이면 없음
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "admin_id")
    private Admin admin;

    @Convert(converter = EncryptedTextConverter.class)
    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    private InquiryMessage(
            Inquiry inquiry,
            AuthorType authorType,
            Admin admin,
            String content,
            OffsetDateTime now) {
        this.inquiry = inquiry;
        this.authorType = authorType;
        this.admin = admin;
        this.content = content;
        this.createdAt = now;
    }

    static InquiryMessage question(Inquiry inquiry, String content, OffsetDateTime now) {
        return new InquiryMessage(inquiry, AuthorType.USER, null, content, now);
    }

    static InquiryMessage answer(Inquiry inquiry, Admin admin, String content, OffsetDateTime now) {
        return new InquiryMessage(inquiry, AuthorType.ADMIN, admin, content, now);
    }
}
