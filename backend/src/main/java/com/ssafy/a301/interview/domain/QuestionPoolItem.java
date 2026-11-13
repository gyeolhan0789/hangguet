package com.ssafy.a301.interview.domain;

import com.ssafy.a301.application.domain.Application;
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
import java.util.Map;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 질문 보관함의 질문 하나(BE 설계 3장, AI 명세 2장 질문 보관함). 보관함은 지원서 + 면접관(persona)마다 하나다. 개인 면접의 plan.completed로
 * 받은 질문을 질문마다 한 행으로 저장한다. 그룹 면접의 질문은 저장하지 않는다. 저장 순서(id)로 배정 순서를 정한다.
 */
@Entity
@Table(name = "question_pool_items")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class QuestionPoolItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "application_id", nullable = false)
    private Application application;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Persona persona;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String criteria;

    // 질문이 파고드는 주장 id
    @Column(name = "claim_id", length = 50)
    private String claimId;

    // 질문을 연결한 회사 항목. 받은 객체 그대로 둔다(폐기 기준에서 카드 항목과 비교한다, AI 명세 2장). 연결하지 않은 질문은 null
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "company_item", columnDefinition = "jsonb")
    private Map<String, Object> companyItem;

    @Column(name = "prompt_version", nullable = false, length = 100)
    private String promptVersion;

    @Column(name = "model_version", nullable = false, length = 100)
    private String modelVersion;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    // 실제로 출제한(question.started) 시각. 출제하지 않은 질문은 null이고 사용 처리한 질문은 다시 배정하지 않는다
    @Column(name = "used_at")
    private OffsetDateTime usedAt;

    public QuestionPoolItem(
            Application application,
            Persona persona,
            PlanQuestion question,
            String promptVersion,
            String modelVersion) {
        this.application = application;
        this.persona = persona;
        this.content = question.content();
        this.criteria = question.criteria();
        this.claimId = question.claimId();
        this.companyItem = question.companyItem();
        this.promptVersion = promptVersion;
        this.modelVersion = modelVersion;
    }

    /** 사용 처리. 두 면접에 배정돼 이미 사용 처리했으면 처음 출제한 시각을 둔다 */
    public void markUsed(OffsetDateTime at) {
        if (usedAt == null) {
            usedAt = at;
        }
    }

    /** 면접 계획의 질문으로. seq는 배정한 자리다 */
    public PlanQuestion toPlanQuestion(int seq) {
        return new PlanQuestion(seq, content, criteria, claimId, companyItem, id);
    }
}
