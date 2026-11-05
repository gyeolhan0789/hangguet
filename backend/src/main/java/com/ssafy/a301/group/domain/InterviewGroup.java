package com.ssafy.a301.group.domain;

import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.Persona;
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
import org.hibernate.annotations.CreationTimestamp;

/** 그룹 면접(docs/그룹면접-설계.md 4.2). 참가자마다 개인 면접을 두고 이 그룹이 묶는다. 상태 전이는 이 클래스의 메서드로만 한다. */
@Entity
@Table(name = "interview_groups")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class InterviewGroup {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 지금 방장. 방장이 나가거나 대기실 조회를 멈추면 바뀐다
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "host_user_id", nullable = false)
    private User host;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private InterviewMode mode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Persona persona;

    @Enumerated(EnumType.STRING)
    @Column(name = "job_category", nullable = false, length = 30)
    private JobCategory jobCategory;

    // 정원 2~3(방장 포함)
    @Column(nullable = false)
    private int capacity;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private GroupStatus status;

    // 대기 중인 그룹끼리만 겹치지 않는다
    @Column(name = "invite_code", nullable = false, length = 6)
    private String inviteCode;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public InterviewGroup(
            User host,
            InterviewMode mode,
            Persona persona,
            JobCategory jobCategory,
            int capacity,
            String inviteCode) {
        this.host = host;
        this.mode = mode;
        this.persona = persona;
        this.jobCategory = jobCategory;
        this.capacity = capacity;
        this.inviteCode = inviteCode;
        this.status = GroupStatus.WAITING;
    }

    public boolean isHost(long userId) {
        return host.getId() == userId;
    }

    /** 대기 중인데 만든 지 waitingExpiry가 지났다. 상태는 조회 · 참가 확인 때 바꾼다(docs/그룹면접-설계.md 5.1) */
    public boolean isExpired(OffsetDateTime now, Duration waitingExpiry) {
        return status == GroupStatus.WAITING && !createdAt.plus(waitingExpiry).isAfter(now);
    }

    /** 초대 코드로 들어올 수 있다 */
    public boolean isJoinable(OffsetDateTime now, Duration waitingExpiry) {
        return status == GroupStatus.WAITING && !isExpired(now, waitingExpiry);
    }

    public void changeHost(User host) {
        this.host = host;
    }

    // 모두 나감 · 만든 지 오래됨 · 시작 실패 뒤 남은 참가자 1명 이하
    public void cancel() {
        if (!status.isLobby()) {
            throw new IllegalStateException("대기실이 아닌 그룹은 취소하지 않는다: " + id);
        }
        this.status = GroupStatus.CANCELLED;
    }
}
