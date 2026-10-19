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

/** 약관 동의 기록. 회원가입(1.2) 때 서비스 및 개인정보 이용약관 1개를 기록한다. */
@Entity
@Table(name = "user_agreements")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserAgreement {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(name = "terms_type", nullable = false, length = 20)
    private TermsType termsType;

    @Column(name = "terms_version", nullable = false, length = 20)
    private String termsVersion;

    @CreationTimestamp
    @Column(name = "agreed_at", nullable = false, updatable = false)
    private OffsetDateTime agreedAt;

    public UserAgreement(User user, TermsType termsType, String termsVersion) {
        this.user = user;
        this.termsType = termsType;
        this.termsVersion = termsVersion;
    }
}
