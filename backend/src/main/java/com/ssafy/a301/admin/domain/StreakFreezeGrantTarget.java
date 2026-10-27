package com.ssafy.a301.admin.domain;

import com.ssafy.a301.user.domain.User;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 지정 회원(USERS) 배포의 받을 회원. 지급 날짜에 이 회원에게 유지권을 만든다. */
@Entity
@Table(
        name = "streak_freeze_grant_targets",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uk_streak_freeze_grant_targets_grant_user",
                        columnNames = {"grant_id", "user_id"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StreakFreezeGrantTarget {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "grant_id", nullable = false)
    private StreakFreezeGrant grant;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    public StreakFreezeGrantTarget(StreakFreezeGrant grant, User user) {
        this.grant = grant;
        this.user = user;
    }
}
