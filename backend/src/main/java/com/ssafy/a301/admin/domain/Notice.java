package com.ssafy.a301.admin.domain;

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
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/** 공지. 게시 기간(startsAt ~ endsAt) 동안 모든 회원에게 보인다. endsAt이 없으면 계속 보인다. */
@Entity
@Table(name = "notices")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Notice {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "admin_id", nullable = false)
    private Admin admin;

    @Column(nullable = false, length = 100)
    private String title;

    @Column(nullable = false, columnDefinition = "text")
    private String content;

    @Column(name = "starts_at", nullable = false)
    private OffsetDateTime startsAt;

    @Column(name = "ends_at")
    private OffsetDateTime endsAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;

    public Notice(
            Admin admin,
            String title,
            String content,
            OffsetDateTime startsAt,
            OffsetDateTime endsAt) {
        this.admin = admin;
        this.title = title;
        this.content = content;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
    }

    // 8.6: 보낸 필드만 바꾼다(null은 그대로)
    public void update(String title, String content, OffsetDateTime startsAt) {
        if (title != null) {
            this.title = title;
        }
        if (content != null) {
            this.content = content;
        }
        if (startsAt != null) {
            this.startsAt = startsAt;
        }
    }

    /** 게시 종료 일시를 바꾼다. null이면 지워 계속 보여 준다 */
    public void changeEndsAt(OffsetDateTime endsAt) {
        this.endsAt = endsAt;
    }

    // 8.7: 행은 남기고 목록 · 사용자 화면(8.8)에서 뺀다
    public void delete(OffsetDateTime now) {
        this.deletedAt = now;
    }
}
