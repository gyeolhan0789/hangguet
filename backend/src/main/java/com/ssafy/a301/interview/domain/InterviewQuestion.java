package com.ssafy.a301.interview.domain;

import com.ssafy.a301.group.domain.TurnKind;
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

/**
 * 면접 질문. 면접 에이전트가 질문을 말하기 시작한 시점(question.started의 startedAt)을 created_at으로 만든다. 다시보기 마커가
 * created_at − 면접 started_at이라 면접 플랜의 예상 질문을 미리 넣으면 마커가 어긋난다. 글·채점 기준·버전도 question.started로 받은 실제
 * 출제 질문의 값이다(BE 설계 3장).
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

    // 실제로 출제한 질문 글. 2·4·5번은 꼬리질문이면 플랜과 다르다(AI 명세 2.2)
    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    // 이 질문의 채점 기준. 채점·결과 생성은 플랜이 아니라 이 값을 쓴다. V18 전 행은 플랜에서 채웠다
    @Column(columnDefinition = "TEXT")
    private String criteria;

    // 꼬리질문을 만든 프롬프트·모델 버전. 예비 질문과 V18 전 행은 null
    @Column(name = "prompt_version", length = 100)
    private String promptVersion;

    @Column(name = "model_version", length = 100)
    private String modelVersion;

    // 질문을 낸 시각. 메시지가 늦게 처리돼도 말하기 시작한 시각을 남기도록 직접 정한다
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    // 그룹 면접의 질문 종류(docs/그룹면접-설계.md 4.3). 개인 면접은 null
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private TurnKind kind;

    // 그룹 면접에서 질문 음성이 끝나 답변 시간을 시작한 시각과 연장을 반영한 답변 마감. 개인 면접은 null
    @Column(name = "spoken_at")
    private OffsetDateTime spokenAt;

    @Column(name = "deadline_at")
    private OffsetDateTime deadlineAt;

    // 그룹 면접에서 답 없이 마감한 시각
    @Column(name = "closed_at")
    private OffsetDateTime closedAt;

    public InterviewQuestion(InterviewSession session, int seq, String content) {
        this(session, seq, content, OffsetDateTime.now());
    }

    public InterviewQuestion(
            InterviewSession session, int seq, String content, OffsetDateTime askedAt) {
        this(session, seq, content, null, null, null, askedAt);
    }

    public InterviewQuestion(
            InterviewSession session,
            int seq,
            String content,
            String criteria,
            String promptVersion,
            String modelVersion,
            OffsetDateTime askedAt) {
        this.session = session;
        this.seq = seq;
        this.content = content;
        this.criteria = criteria;
        this.promptVersion = promptVersion;
        this.modelVersion = modelVersion;
        this.createdAt = askedAt;
    }

    /** 그룹 면접의 질문(question.started, docs/그룹면접-설계.md 6.4) */
    public static InterviewQuestion groupTurn(
            InterviewSession session,
            int seq,
            TurnKind kind,
            String content,
            String criteria,
            String promptVersion,
            String modelVersion,
            OffsetDateTime askedAt) {
        InterviewQuestion question =
                new InterviewQuestion(
                        session, seq, content, criteria, promptVersion, modelVersion, askedAt);
        question.kind = kind;
        return question;
    }

    /** 질문 음성이 끝나 답변 시간을 시작했다(question.spoken 또는 기한 초과) */
    public void startAnswering(OffsetDateTime spokenAt, OffsetDateTime deadlineAt) {
        this.spokenAt = spokenAt;
        this.deadlineAt = deadlineAt;
    }

    /** 그룹 면접에서 답변 중 나갔던 질문을 다시 묻는다(docs/그룹면접-설계.md 6.9). 답변 시간은 새로 센다 */
    public void reask() {
        this.spokenAt = null;
        this.deadlineAt = null;
    }

    /** 10.8 답변 시간 연장 */
    public void extendDeadline(OffsetDateTime deadlineAt) {
        this.deadlineAt = deadlineAt;
    }

    /** 답 없이 마감했다(docs/그룹면접-설계.md 6.6) */
    public void close(OffsetDateTime now) {
        if (closedAt == null) {
            this.closedAt = now;
        }
    }

    public boolean isClosed() {
        return closedAt != null;
    }
}
