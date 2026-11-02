package com.ssafy.a301.user.domain;

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
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 소셜 계정 연결(1.6 · 1.7 · 2.12). 제공자가 알려 준 회원 번호로 우리 회원을 찾는다. 소셜 회원은 가입한 계정, 이메일 회원은 직접 연결한 계정(2.12)
 * 하나만 가진다(부분 UNIQUE 인덱스 uk_user_social_accounts_user_active). 탈퇴하지 않은 연결끼리만 같은 제공자 계정 중복 불가(부분
 * UNIQUE 인덱스 uk_user_social_accounts_active). 회원이 탈퇴하면 함께 탈퇴 처리해 같은 소셜 계정으로 다시 가입할 수 있다. 이메일 회원이
 * 연결을 끊으면(2.13) 행을 지운다.
 */
@Entity
@Table(name = "user_social_accounts")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserSocialAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private SocialProvider provider;

    @Column(name = "provider_user_id", nullable = false, length = 255)
    private String providerUserId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "withdrawn_at")
    private OffsetDateTime withdrawnAt;

    public UserSocialAccount(User user, SocialProvider provider, String providerUserId) {
        this.user = user;
        this.provider = provider;
        this.providerUserId = providerUserId;
    }
}
