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
import java.util.List;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

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

    // 처음 시작할 때 고른 공통 질문 2개(자기소개 → 인성). 다시 시작해도 바꾸지 않는다. 시작 전에는 null
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "common_questions", columnDefinition = "jsonb")
    private List<CommonQuestion> commonQuestions;

    // 진행 상태(docs/그룹면접-설계.md 5.2). 시작 전에는 null이다
    private Integer round;

    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private GroupPhase phase;

    // 현재 답변자의 면접
    @Column(name = "turn_session_id")
    private Long turnSessionId;

    // 현재 질문의 그 면접 안 순서(1~6)
    @Column(name = "turn_seq")
    private Integer turnSeq;

    @Enumerated(EnumType.STRING)
    @Column(name = "turn_kind", length = 20)
    private TurnKind turnKind;

    @Enumerated(EnumType.STRING)
    @Column(name = "turn_announce", length = 10)
    private TurnAnnounce turnAnnounce;

    // 차례 · 단계가 바뀔 때마다 1 증가. 받는 쪽은 가진 값 이하를 버린다(API 명세 10.11)
    @Column(name = "turn_version", nullable = false)
    private int turnVersion;

    // 현재 질문의 답변 마감. ANSWERING에서만 값이 있다
    @Column(name = "deadline_at")
    private OffsetDateTime deadlineAt;

    @Column(nullable = false)
    private boolean extended;

    // 현재 단계가 끝나야 하는 시각. 지나면 정체로 본다(6.11)
    @Column(name = "phase_due_at")
    private OffsetDateTime phaseDueAt;

    @Column(name = "progressed_at")
    private OffsetDateTime progressedAt;

    // 마지막 시작 시도 시각
    @Column(name = "started_at")
    private OffsetDateTime startedAt;

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

    /** 처음 시작할 때만 공통 질문을 정한다. 다시 시작이면 이미 정한 질문을 쓴다 */
    public boolean hasCommonQuestions() {
        return commonQuestions != null;
    }

    public void chooseCommonQuestions(List<CommonQuestion> questions) {
        if (hasCommonQuestions()) {
            throw new IllegalStateException("공통 질문은 처음 시작할 때만 정한다: " + id);
        }
        this.commonQuestions = List.copyOf(questions);
    }

    /**
     * 10.7. 첫 차례(라운드 1, 순서 1번의 자기소개를 질문 전체로 말함, ASKING)를 정한다. 에이전트가 askingTimeout 안에 질문을 시작하지 않으면
     * 정체로 본다(6.11). 다시 시작해도 버전은 이어 센다.
     */
    public void start(OffsetDateTime now, long firstSessionId, Duration askingTimeout) {
        if (!status.isLobby() || !hasCommonQuestions()) {
            throw new IllegalStateException("시작할 수 없는 그룹이다: " + id);
        }
        this.status = GroupStatus.IN_PROGRESS;
        this.startedAt = now;
        this.round = 1;
        this.phase = GroupPhase.ASKING;
        this.turnSessionId = firstSessionId;
        this.turnSeq = 1;
        this.turnKind = TurnKind.COMMON;
        this.turnAnnounce = TurnAnnounce.FULL;
        this.turnVersion++;
        this.deadlineAt = null;
        this.extended = false;
        this.phaseDueAt = now.plus(askingTimeout);
        this.progressedAt = now;
    }

    // 모두 나감 · 만든 지 오래됨 · 시작 실패 뒤 남은 참가자 1명 이하
    public void cancel() {
        if (!status.isLobby()) {
            throw new IllegalStateException("대기실이 아닌 그룹은 취소하지 않는다: " + id);
        }
        this.status = GroupStatus.CANCELLED;
    }
}
