package com.ssafy.a301.interview.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/**
 * AI 분석 작업 Outbox 한 건. id가 작업 메시지의 jobId다. 큐에 보내면 publishedAt을 남긴다. 면접 작업은 sessionId, 지원서 단위 작업(주장
 * 추출)은 applicationId만 값이 있다(AI 명세 1.3).
 */
@Entity
@Table(name = "ai_job_outbox")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AiJob {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Enumerated(EnumType.STRING)
    @Column(name = "job_type", nullable = false, length = 20)
    private AiJobType jobType;

    // 주장 추출(EXTRACT_CLAIMS)만 null이다
    @Column(name = "session_id")
    private Long sessionId;

    // 주장 추출(EXTRACT_CLAIMS)만 값이 있다
    @Column(name = "application_id")
    private Long applicationId;

    // SCORE_ANSWER만 값이 있다
    @Column(name = "answer_id")
    private Long answerId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "published_at")
    private OffsetDateTime publishedAt;

    private AiJob(AiJobType jobType, Long sessionId, Long answerId) {
        this.jobType = jobType;
        this.sessionId = sessionId;
        this.answerId = answerId;
    }

    public static AiJob plan(long sessionId) {
        return new AiJob(AiJobType.PLAN, sessionId, null);
    }

    /** 4.1 저장 뒤, 주장이 없는 지원서로 만든 개인 면접(5.1·5.3)의 지원서 주장 추출(AI 명세 2장 STEP 01) */
    public static AiJob extractClaims(long applicationId) {
        AiJob job = new AiJob(AiJobType.EXTRACT_CLAIMS, null, null);
        job.applicationId = applicationId;
        return job;
    }

    public static AiJob scoreAnswer(long sessionId, long answerId) {
        return new AiJob(AiJobType.SCORE_ANSWER, sessionId, answerId);
    }

    public static AiJob evaluate(long sessionId) {
        return new AiJob(AiJobType.EVALUATE, sessionId, null);
    }

    public static AiJob mergeRecording(long sessionId) {
        return new AiJob(AiJobType.MERGE_RECORDING, sessionId, null);
    }

    public void markPublished(OffsetDateTime now) {
        this.publishedAt = now;
    }
}
