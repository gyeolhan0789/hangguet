package com.ssafy.a301.interview.domain;

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
 * 면접 질문. 질문을 화면에 낸 시점에 만든다. 다시보기 마커가 created_at − 면접 started_at이라 면접 플랜의 예상 질문을 미리 넣으면 마커가 어긋난다.
 */
@Entity
@Table(name = "interview_questions")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class InterviewQuestion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false)
    private InterviewSession session;

    // 면접 안에서의 순서. 1부터
    @Column(nullable = false)
    private int seq;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public InterviewQuestion(InterviewSession session, int seq, String content) {
        this.session = session;
        this.seq = seq;
        this.content = content;
    }
}
