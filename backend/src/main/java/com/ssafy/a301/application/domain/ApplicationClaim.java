package com.ssafy.a301.application.domain;

import com.ssafy.a301.interview.domain.PlanClaim;
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
import java.util.List;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 지원서 자기소개서에서 추출한 주장 하나(BE 설계 3장, AI 명세 2장 STEP 01). 주장 추출 결과(claims.extracted)를 그 지원서에 주장이 없을 때만
 * 저장하고 바꾸지 않는다. 같은 지원서의 개인 면접 질문 생성(PLAN)에 입력으로 쓴다.
 */
@Entity
@Table(name = "application_claims")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class ApplicationClaim {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "application_id", nullable = false)
    private Application application;

    // AI가 붙인 주장 id. 질문의 claimId가 가리킨다
    @Column(name = "claim_id", nullable = false, length = 50)
    private String claimId;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String text;

    // EXPERIENCE(경험) · NUMBER(수치)
    @Column(nullable = false, length = 20)
    private String type;

    // 자기소개서 문장 순번(1부터)
    @Column(name = "sentence_no", nullable = false)
    private int sentenceNo;

    // 주장에 드러난 인재상 기준 이름 0~2개
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "talent_criteria", columnDefinition = "jsonb")
    private List<String> talentCriteria;

    @Column(name = "prompt_version", nullable = false, length = 100)
    private String promptVersion;

    @Column(name = "model_version", nullable = false, length = 100)
    private String modelVersion;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public ApplicationClaim(
            Application application, PlanClaim claim, String promptVersion, String modelVersion) {
        this.application = application;
        this.claimId = claim.id();
        this.text = claim.text();
        this.type = claim.type();
        this.sentenceNo = claim.sentenceNo();
        this.talentCriteria = claim.talentCriteria();
        this.promptVersion = promptVersion;
        this.modelVersion = modelVersion;
    }

    /** 작업 메시지의 주장 형식(AI 명세 2장) */
    public PlanClaim toPlanClaim() {
        return new PlanClaim(claimId, text, type, sentenceNo, talentCriteria);
    }
}
