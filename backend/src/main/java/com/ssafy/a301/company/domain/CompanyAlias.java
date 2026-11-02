package com.ssafy.a301.company.domain;

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

/**
 * 지원서 회사명으로 회사를 찾는 이름. 파이프라인이 정규화한 값(띄어쓰기·(주) 등 제거, 소문자)을 그대로 두고, 적재할 때마다 manifest에 맞춘다. 별칭은 회사
 * 하나에만 붙는다(UNIQUE).
 */
@Entity
@Table(name = "company_aliases")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CompanyAlias {
    public static final int MAX_LENGTH = 100;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "company_id", nullable = false)
    private Company company;

    @Column(nullable = false, length = MAX_LENGTH)
    private String alias;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public CompanyAlias(Company company, String alias) {
        this.company = company;
        this.alias = alias;
    }
}
