package com.ssafy.a301.company.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/** 회사 카드 파이프라인 manifest의 회사(docs/ERD-회사카드.md). DART 고유번호로 찾고, 적재할 때마다 이름·상장 여부를 맞춘다. */
@Entity
@Table(name = "companies")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Company {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "corp_code", nullable = false, length = 8)
    private String corpCode;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(name = "is_listed", nullable = false)
    private boolean listed;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public Company(String corpCode, String name, boolean listed) {
        this.corpCode = corpCode;
        this.name = name;
        this.listed = listed;
    }

    public void update(String name, boolean listed) {
        this.name = name;
        this.listed = listed;
    }
}
