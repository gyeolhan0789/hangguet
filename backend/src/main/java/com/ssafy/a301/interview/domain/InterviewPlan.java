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
import org.hibernate.annotations.Immutable;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 면접 플랜(PK = session_id). AI 분석 작업자(PLAN)가 쓰고 BE는 질문을 낼 때 읽기만 한다. 자소서 주장(claims)과 버전은 AI만 쓰므로 매핑하지
 * 않는다.
 */
@Entity
@Table(name = "interview_plans")
@Immutable
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class InterviewPlan {
    // 면접 질문 수는 5개로 고정이다(API 명세 5.2, AI 명세 2장)
    public static final int QUESTION_COUNT = 5;

    @Id
    @Column(name = "session_id")
    private Long sessionId;

    // seq 1~5로 정확히 5개(AI 명세 2장)
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false, columnDefinition = "jsonb")
    private List<PlanQuestion> questions;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    public Optional<PlanQuestion> question(int seq) {
        return questions.stream().filter(q -> q.seq() == seq).findFirst();
    }
}
