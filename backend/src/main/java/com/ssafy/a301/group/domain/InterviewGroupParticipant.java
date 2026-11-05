package com.ssafy.a301.group.domain;

import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.user.domain.User;
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
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 그룹 참가자(docs/그룹면접-설계.md 4.2). 참가자마다 자기 지원서로 만든 면접이 하나 있다. */
@Entity
@Table(name = "interview_group_participants")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class InterviewGroupParticipant {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "group_id", nullable = false)
    private InterviewGroup group;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false, unique = true)
    private InterviewSession session;

    @Enumerated(EnumType.STRING)
    @Column(name = "job_category", nullable = false, length = 30)
    private JobCategory jobCategory;

    // 방장을 넘길 순서의 기준
    @Column(name = "joined_at", nullable = false)
    private OffsetDateTime joinedAt;

    @Column(name = "ready_at")
    private OffsetDateTime readyAt;

    // 답변 순서(1부터). 시작 전에는 null
    @Column(name = "turn_order")
    private Integer turnOrder;

    @Column(name = "left_at")
    private OffsetDateTime leftAt;

    public InterviewGroupParticipant(
            InterviewGroup group,
            User user,
            InterviewSession session,
            JobCategory jobCategory,
            OffsetDateTime joinedAt) {
        this.group = group;
        this.user = user;
        this.session = session;
        this.jobCategory = jobCategory;
        this.joinedAt = joinedAt;
    }

    public boolean isReady() {
        return readyAt != null;
    }

    // 10.5. 이미 준비했으면 처음 시각을 둔다(다시 보내도 결과가 같다)
    public void changeReady(boolean ready, OffsetDateTime now) {
        if (!ready) {
            this.readyAt = null;
        } else if (readyAt == null) {
            this.readyAt = now;
        }
    }

    // 10.6. 면접은 시작하지 않은 채 남는다
    public void leave(OffsetDateTime now) {
        this.leftAt = now;
    }
}
