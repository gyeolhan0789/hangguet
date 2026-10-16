package com.ssafy.a301.interview.domain;

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
import jakarta.persistence.UniqueConstraint;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 면접의 기준별 점수. 면접당 기준 4개. */
@Entity
@Table(
        name = "session_scores",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uk_session_scores_session_criterion",
                        columnNames = {"session_id", "criterion"}))
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SessionScore {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false)
    private InterviewSession session;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Criterion criterion;

    // 0~100. 자소서 검증은 명확한 충돌 개수만큼 100점에서 차감(차감 폭 B-10)
    @Column(nullable = false)
    private int score;

    // 성장 리뷰·홈 "다음에 해볼 것"에도 쓰인다
    @Column(length = 255)
    private String comment;

    public SessionScore(InterviewSession session, Criterion criterion, int score, String comment) {
        this.session = session;
        this.criterion = criterion;
        this.score = score;
        this.comment = comment;
    }
}
