package com.ssafy.a301.group.domain;

import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionStatus;
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
import java.time.Duration;
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
    // 한 사람이 받을 수 있는 꼬리질문 수(API 명세 10장)
    public static final int MAX_FOLLOWUPS = 2;
    // 한 사람의 기본 질문 수(공통 2 + 개인 2, docs/그룹면접-설계.md 2장)
    public static final int BASE_QUESTIONS = 4;

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

    // 끝낸 기본 질문 수 0~4(답했든 시간이 다 됐든)
    @Column(name = "base_done", nullable = false)
    private int baseDone;

    // 받은 꼬리질문 수 0~2
    @Column(name = "followups_used", nullable = false)
    private int followupsUsed;

    // 질문을 모두 마친 시각. 이 뒤에 화면이 5.8을 부른다
    @Column(name = "done_at")
    private OffsetDateTime doneAt;

    // 진행 중 면접방에서 나간 시각. 다시 들어오면 null(6.9)
    @Column(name = "absent_since")
    private OffsetDateTime absentSince;

    // 이 시각까지 다시 들어올 수 있다. 지나면 면접을 끝낸다(group.absence-limit, 6.9). 다시 들어오면 null
    @Column(name = "absent_until")
    private OffsetDateTime absentUntil;

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

    // 10.7. 처음 시작할 때 무작위로 정하고, 다시 시작하면 남은 참가자끼리 같은 순서로 다시 센다
    public void assignTurnOrder(int turnOrder) {
        this.turnOrder = turnOrder;
    }

    /** 다음에 받을 질문의 면접 안 순서(1~6). 끝낸 기본 질문 · 꼬리질문 다음이다 */
    public int nextSeq() {
        return baseDone + followupsUsed + 1;
    }

    /** 질문을 더 받을 수 있다. 면접이 진행 중이고 질문을 모두 마치지 않았다 */
    public boolean isAnswering() {
        return session.getStatus() == SessionStatus.IN_PROGRESS && doneAt == null;
    }

    public boolean isDone() {
        return doneAt != null;
    }

    public boolean canReceiveFollowup() {
        return followupsUsed < MAX_FOLLOWUPS;
    }

    // 지금 차례의 질문을 끝냈다(답했든 시간이 다 됐든)
    public void finishQuestion(TurnKind kind) {
        if (kind == TurnKind.FOLLOWUP) {
            followupsUsed++;
        } else {
            baseDone++;
        }
    }

    // 기본 질문을 모두 마쳤고 꼬리질문도 없다
    public void complete(OffsetDateTime now) {
        if (doneAt == null) {
            this.doneAt = now;
        }
    }

    public boolean isAbsent() {
        return absentSince != null;
    }

    /** 이탈했으면 이 시각까지 다시 들어올 수 있다. 아니면 null */
    public OffsetDateTime absentUntil() {
        return absentUntil;
    }

    /** 다시 들어올 수 있는 시간이 지났다. 다시 들어올 수 없다(5.14) */
    public boolean isAbsentTooLong(OffsetDateTime now) {
        return absentUntil != null && !now.isBefore(absentUntil);
    }

    // 6.9. 처음 나간 시각을 둔다(퇴장이 두 번 와도 결과가 같다)
    public boolean markAbsent(OffsetDateTime at, Duration limit) {
        if (absentSince != null) {
            return false;
        }
        this.absentSince = at;
        this.absentUntil = at.plus(limit);
        return true;
    }

    // 6.9. 다시 들어왔다
    public boolean markPresent() {
        if (absentSince == null) {
            return false;
        }
        this.absentSince = null;
        this.absentUntil = null;
        return true;
    }

    // 10.6. 면접은 시작하지 않은 채 남는다
    public void leave(OffsetDateTime now) {
        this.leftAt = now;
    }
}
