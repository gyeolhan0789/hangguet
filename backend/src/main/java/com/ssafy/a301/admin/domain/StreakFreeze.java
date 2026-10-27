package com.ssafy.a301.admin.domain;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.User;
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

/**
 * 스트릭 유지권. 한 행이 유지권 1개이며 메울 수 있는 날짜(fillableDate) 하나만 연습한 날로 메운다. 배포를 지급할 때 대상 회원 수 × 개수만큼 한 번에
 * 넣는다(StreakFreezeRepository.insertForGrant).
 */
@Entity
@Table(name = "streak_freezes")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StreakFreeze {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "grant_id", nullable = false)
    private StreakFreezeGrant grant;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private StreakFreezeStatus status;

    @Column(name = "granted_at", nullable = false)
    private OffsetDateTime grantedAt;

    // 지급 날짜(한국 시간) 0시부터 2주
    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    // 한국 시간 기준 날짜
    @Column(name = "fillable_date", nullable = false)
    private LocalDate fillableDate;

    @Column(name = "used_at")
    private OffsetDateTime usedAt;

    /** 쓸 수 있으면(AVAILABLE이고 만료 전) 사용함으로 바꾼다. 이미 썼거나 기간이 지났으면 409 */
    public void use(OffsetDateTime now) {
        if (status != StreakFreezeStatus.AVAILABLE || !expiresAt.isAfter(now)) {
            throw new ApiException(ErrorCode.STREAK_FREEZE_NOT_AVAILABLE);
        }
        this.status = StreakFreezeStatus.USED;
        this.usedAt = now;
    }
}
