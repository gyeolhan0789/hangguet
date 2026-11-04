package com.ssafy.a301.interview.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import org.springframework.data.domain.Persistable;

/**
 * 면접 플랜(PK = session_id). AI 분석 작업자가 만든 결과(plan.completed)를 BE가 저장하고, 면접 에이전트 배정·채점 작업에 쓴다(AI 명세
 * 2장). 면접당 한 번만 저장하며 바꾸지 않는다.
 */
@Entity
@Table(name = "interview_plans")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class InterviewPlan implements Persistable<Long> {
    // 면접 질문 수는 5개로 고정이다(API 명세 5.2, AI 명세 2장)
    public static final int QUESTION_COUNT = 5;

    // 그룹 면접은 개인 맞춤 질문 2개만 만든다(API 명세 10장, AI 명세 2장 questionCount)
    public static final int GROUP_QUESTION_COUNT = 2;

    @Id
    @Column(name = "session_id")
    private Long sessionId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private List<PlanClaim> claims;

    // seq 1~5로 정확히 5개, 그룹 면접은 seq 1~2로 2개(AI 명세 2장)
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private List<PlanQuestion> questions;

    @Column(name = "prompt_version", nullable = false, length = 100)
    private String promptVersion;

    @Column(name = "model_version", nullable = false, length = 100)
    private String modelVersion;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public InterviewPlan(
            long sessionId,
            List<PlanClaim> claims,
            List<PlanQuestion> questions,
            String promptVersion,
            String modelVersion) {
        this.sessionId = sessionId;
        this.claims = claims;
        this.questions = questions;
        this.promptVersion = promptVersion;
        this.modelVersion = modelVersion;
    }

    /** 플랜에 담을 질문 수 */
    public static int questionCount(InterviewSession session) {
        return session.isGroup() ? GROUP_QUESTION_COUNT : QUESTION_COUNT;
    }

    public Optional<PlanQuestion> question(int seq) {
        return questions.stream().filter(q -> q.seq() == seq).findFirst();
    }

    @Override
    public Long getId() {
        return sessionId;
    }

    // id를 직접 정하므로 저장 전인지는 생성 일시로 가린다(save가 merge 대신 persist하게)
    @Override
    public boolean isNew() {
        return createdAt == null;
    }
}
