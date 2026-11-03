package com.ssafy.a301.inquiry.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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

/** 문의 메시지에 붙인 사진 한 장(V17). 파일은 S3에 있고 키만 저장한다. */
@Entity
@Table(name = "inquiry_attachments")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class InquiryAttachment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "message_id", nullable = false)
    private InquiryMessage message;

    @Column(name = "object_key", nullable = false, length = 500, unique = true)
    private String objectKey;

    @Column(name = "content_type", nullable = false, length = 50)
    private String contentType;

    @Column(nullable = false)
    private long size;

    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public InquiryAttachment(
            InquiryMessage message,
            String objectKey,
            String contentType,
            long size,
            OffsetDateTime now) {
        this.message = message;
        this.objectKey = objectKey;
        this.contentType = contentType;
        this.size = size;
        this.createdAt = now;
    }
}
