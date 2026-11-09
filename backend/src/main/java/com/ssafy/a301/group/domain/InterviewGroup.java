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

    // 지금 차례를 정했을 때의 turnVersion. 에이전트 메시지는 이 값 이상 turnVersion 이하일 때만 지금 차례의 것으로 본다
    @Column(name = "turn_started_version", nullable = false)
    private int turnStartedVersion;

    // LiveKit 면접방 정보에 마지막으로 반영한 turnVersion(6.5 재동기화). 커밋 뒤 보내기에 성공하면 저장소가 직접 바꾼다
    @Column(name = "room_version", nullable = false, insertable = false, updatable = false)
    private int roomVersion;

    // 채팅 최종 답변(group.answer)을 에이전트에 전한 차례의 turnVersion(6.14). 저장소가 직접 바꾼다
    @Column(name = "answer_sent_version", nullable = false, insertable = false, updatable = false)
    private int answerSentVersion;

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

    // 마지막 세션이 끝난 시각(6.10)
    @Column(name = "ended_at")
    private OffsetDateTime endedAt;

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
        this.turnStartedVersion = turnVersion;
        this.deadlineAt = null;
        this.extended = false;
        this.phaseDueAt = now.plus(askingTimeout);
        this.progressedAt = now;
    }

    /**
     * 에이전트 메시지가 지금 차례의 것인지(docs/그룹면접-설계.md 8.4). 같은 답변자 · 질문 순서이고, 차례를 정한 뒤의 면접방 정보를 보고 보낸 것이어야 한다.
     * 차례 안에서도 단계 · 연장으로 버전이 오르므로 같은 값이 아니라 범위로 본다.
     */
    public boolean isCurrentTurn(long sessionId, int seq, int version) {
        return status == GroupStatus.IN_PROGRESS
                && turnSessionId != null
                && turnSessionId == sessionId
                && turnSeq != null
                && turnSeq == seq
                && version >= turnStartedVersion
                && version <= turnVersion;
    }

    public boolean isPhase(GroupPhase phase) {
        return status == GroupStatus.IN_PROGRESS && this.phase == phase;
    }

    /**
     * 다음 차례를 정한다(6.3). 에이전트가 askingTimeout 안에 질문을 시작하지 않으면 정체로 본다(6.11).
     *
     * @param announce 질문 전체를 말할지 같은 공통 질문의 다음 답변자를 호명만 할지
     */
    public void assignTurn(
            OffsetDateTime now,
            int round,
            long sessionId,
            int seq,
            TurnKind kind,
            TurnAnnounce announce,
            Duration askingTimeout) {
        requireInProgress();
        this.round = round;
        this.turnSessionId = sessionId;
        this.turnSeq = seq;
        this.turnKind = kind;
        this.turnAnnounce = announce;
        this.extended = false;
        moveTo(GroupPhase.ASKING, now, now.plus(askingTimeout));
        this.turnStartedVersion = turnVersion;
    }

    /** 남은 질문이 없다(6.3 규칙 6). 남은 사람은 질문을 모두 마치고 5.8을 기다린다 */
    public void finishTurns(OffsetDateTime now) {
        requireInProgress();
        this.turnSessionId = null;
        this.turnSeq = null;
        this.turnKind = null;
        this.turnAnnounce = null;
        this.extended = false;
        moveTo(null, now, null);
    }

    /** ASKING → SPEAKING. 에이전트가 질문 음성을 보내기 시작했다(question.started) */
    public void startSpeaking(OffsetDateTime now, OffsetDateTime dueAt) {
        requirePhase(GroupPhase.ASKING);
        moveTo(GroupPhase.SPEAKING, now, dueAt);
    }

    /** SPEAKING → ANSWERING. 질문 음성이 끝나 답변 시간을 시작했다(question.spoken) */
    public void startAnswering(
            OffsetDateTime now, OffsetDateTime deadlineAt, OffsetDateTime dueAt) {
        requirePhase(GroupPhase.SPEAKING);
        moveTo(GroupPhase.ANSWERING, now, dueAt);
        this.deadlineAt = deadlineAt;
    }

    /** ANSWERING → DECIDING. 최종 답변을 저장해 에이전트의 꼬리질문 판단을 기다린다 */
    public void startDeciding(OffsetDateTime now, OffsetDateTime dueAt) {
        requirePhase(GroupPhase.ANSWERING);
        moveTo(GroupPhase.DECIDING, now, dueAt);
    }

    /** 10.8. 답변 마감을 늦춘다. 한 질문에 한 번만이고 조건은 부르는 쪽이 확인한다 */
    public void extend(OffsetDateTime now, OffsetDateTime deadlineAt, OffsetDateTime dueAt) {
        requirePhase(GroupPhase.ANSWERING);
        if (extended) {
            throw new IllegalStateException("이미 연장한 질문이다: " + id);
        }
        this.extended = true;
        this.deadlineAt = deadlineAt;
        this.phaseDueAt = dueAt;
        this.turnVersion++;
        this.progressedAt = now;
    }

    /** ASKING 기한이 지났지만 에이전트가 면접방 정보를 놓쳤을 수 있어 한 번 더 기다린다(6.11). 버전은 그대로 두고 같은 정보를 다시 보낸다 */
    public void waitAsking(OffsetDateTime dueAt) {
        requirePhase(GroupPhase.ASKING);
        this.phaseDueAt = dueAt;
    }

    /** 첫 질문 전에 AI를 연결하지 못했다(5.1). 방장이 다시 시작(10.7)할 수 있다. 답변 순서 · 공통 질문은 그대로 둔다 */
    public void failStart() {
        requireInProgress();
        this.status = GroupStatus.START_FAILED;
        this.phase = null;
        this.deadlineAt = null;
        this.phaseDueAt = null;
    }

    /** 차례는 그대로이고 참가자 상태만 바뀌었다(세션 종료 · 질문을 모두 마침). 면접방 정보를 다시 보내도록 버전만 올린다 */
    public void touch(OffsetDateTime now) {
        requireInProgress();
        this.turnVersion++;
        this.progressedAt = now;
    }

    // 단계가 바뀔 때마다 버전을 올린다. 마감은 ANSWERING에서만 둔다
    private void moveTo(GroupPhase phase, OffsetDateTime now, OffsetDateTime dueAt) {
        this.phase = phase;
        this.deadlineAt = null;
        this.phaseDueAt = dueAt;
        this.turnVersion++;
        this.progressedAt = now;
    }

    private void requirePhase(GroupPhase expected) {
        if (!isPhase(expected)) {
            throw new IllegalStateException("단계가 " + expected + "가 아니다: " + id + " " + phase);
        }
    }

    private void requireInProgress() {
        if (status != GroupStatus.IN_PROGRESS) {
            throw new IllegalStateException("진행 중인 그룹이 아니다: " + id);
        }
    }

    /** 마지막 세션이 끝났다(docs/그룹면접-설계.md 6.10). 진행 단계 · 기한을 지워 더는 진행하지 않는다. 남은 사람에게 끝났다고 알리도록 버전을 올린다 */
    public void end(OffsetDateTime now) {
        if (status != GroupStatus.IN_PROGRESS) {
            throw new IllegalStateException("진행 중이 아닌 그룹은 끝내지 않는다: " + id);
        }
        this.status = GroupStatus.ENDED;
        this.endedAt = now;
        this.phase = null;
        this.deadlineAt = null;
        this.phaseDueAt = null;
        this.turnVersion++;
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
