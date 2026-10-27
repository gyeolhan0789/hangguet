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

/** AI 분석 작업 Outbox 한 건. id가 작업 메시지의 jobId다. 큐에 보내면 publishedAt을 남긴다. */
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

    @Column(name = "session_id", nullable = false)
    private Long sessionId;

    // SCORE_ANSWER만 값이 있다
    @Column(name = "answer_id")
    private Long answerId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "published_at")
    private OffsetDateTime publishedAt;

    private AiJob(AiJobType jobType, long sessionId, Long answerId) {
        this.jobType = jobType;
        this.sessionId = sessionId;
        this.answerId = answerId;
    }

    public static AiJob plan(long sessionId) {
        return new AiJob(AiJobType.PLAN, sessionId, null);
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

    public static AiJob writeHeadline(long sessionId) {
        return new AiJob(AiJobType.WRITE_HEADLINE, sessionId, null);
    }

    public void markPublished(OffsetDateTime now) {
        this.publishedAt = now;
    }
}
