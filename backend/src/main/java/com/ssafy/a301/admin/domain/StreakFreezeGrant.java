package com.ssafy.a301.admin.domain;

import jakarta.persistence.Column;
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
import java.time.LocalDate;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/** 유지권 배포. 지급 날짜(한국 시간)가 되면 대상 회원마다 유지권을 개수만큼 만들고 GRANTED가 된다. 취소하지 않는다. */
@Entity
@Table(name = "streak_freeze_grants")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StreakFreezeGrant {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "admin_id", nullable = false)
    private Admin admin;

    @Enumerated(EnumType.STRING)
    @Column(name = "target_type", nullable = false, length = 20)
    private GrantTarget targetType;

    @Column(nullable = false)
    private int quantity;

    // 한국 시간 기준 날짜
    @Column(name = "grant_date", nullable = false)
    private LocalDate grantDate;

    // 받은 회원이 메울 수 있는 날짜(한국 시간). 지급할 때 유지권마다 옮겨 적는다
    @Column(name = "fillable_date", nullable = false)
    private LocalDate fillableDate;

    @Column(length = 255)
    private String reason;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private GrantStatus status;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "granted_at")
    private OffsetDateTime grantedAt;

    public StreakFreezeGrant(
            Admin admin,
            GrantTarget targetType,
            int quantity,
            LocalDate grantDate,
            LocalDate fillableDate,
            String reason) {
        this.admin = admin;
        this.targetType = targetType;
        this.quantity = quantity;
        this.grantDate = grantDate;
        this.fillableDate = fillableDate;
        this.reason = reason;
        this.status = GrantStatus.SCHEDULED;
    }

    /** 지급 날짜가 오늘이거나 지났고 아직 지급하지 않았으면 true */
    public boolean isDue(LocalDate today) {
        return status == GrantStatus.SCHEDULED && !grantDate.isAfter(today);
    }

    public void markGranted(OffsetDateTime now) {
        this.status = GrantStatus.GRANTED;
        this.grantedAt = now;
    }
}
