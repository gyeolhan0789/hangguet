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
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Map;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 회사 카드 한 장. 파이프라인이 만든 카드 JSON을 해석하지 않고 그대로 두며 AI 작업 메시지(companyCard)에도 그대로 담는다. 내용(content_hash)이
 * 바뀔 때만 새 행을 넣고, 회사당 최신 카드(is_current)는 하나다(부분 UNIQUE 인덱스 uk_company_cards_current).
 */
@Entity
@Table(name = "company_cards")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CompanyCard {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "company_id", nullable = false)
    private Company company;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private Map<String, Object> card;

    // 카드 파일 내용의 sha256(manifest 값). 다시 직렬화한 JSON이 아니라 올라온 파일 그대로의 해시다
    @Column(name = "content_hash", nullable = false, length = 64)
    private String contentHash;

    @Column(name = "generated_at", nullable = false)
    private LocalDate generatedAt;

    @Column(name = "is_current", nullable = false)
    private boolean current;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public CompanyCard(
            Company company, Map<String, Object> card, String contentHash, LocalDate generatedAt) {
        this.company = company;
        this.card = card;
        this.contentHash = contentHash;
        this.generatedAt = generatedAt;
        this.current = true;
    }

    /** 새 카드가 들어와 최신이 아니게 된다 */
    public void retire() {
        this.current = false;
    }
}
