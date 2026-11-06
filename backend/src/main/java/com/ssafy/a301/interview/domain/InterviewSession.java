package com.ssafy.a301.interview.domain;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.company.domain.CompanyCard;
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
import org.hibernate.annotations.CreationTimestamp;

/** 면접. 상태 전이는 이 클래스의 메서드로만 한다. */
@Entity
@Table(name = "interview_sessions")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class InterviewSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "application_id", nullable = false)
    private Application application;

    // 면접을 만들 때 지원서 회사명으로 찾은 회사 카드. 못 찾았으면 null. 면접 안에서는 바꾸지 않는다(docs/ERD-회사카드.md)
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "company_card_id")
    private CompanyCard companyCard;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Persona persona;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private InterviewMode mode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private SessionStatus status;

    // 결과 화면 맨 위의 한 줄 총평(30자 이내)
    @Column(length = 30)
    private String headline;

    // 성장 리뷰의 "다음에 해볼 것". 그날 이 면접까지를 모두 반영한 요약
    @Column(length = 255)
    private String summary;

    // 그룹 면접 참가자의 면접이면 그룹 id, 개인 면접은 null(docs/그룹면접-설계.md 4.3)
    @Column(name = "group_id")
    private Long groupId;

    @Column(name = "started_at")
    private OffsetDateTime startedAt;

    @Column(name = "ended_at")
    private OffsetDateTime endedAt;

    // 그룹 세션이 끝난 이유. 개인 면접은 null이다
    @Enumerated(EnumType.STRING)
    @Column(name = "end_reason", length = 20)
    private EndReason endReason;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public InterviewSession(
            User user, Application application, Persona persona, InterviewMode mode) {
        this(user, application, null, persona, mode);
    }

    public InterviewSession(
            User user,
            Application application,
            CompanyCard companyCard,
            Persona persona,
            InterviewMode mode) {
        this.user = user;
        this.application = application;
        this.companyCard = companyCard;
        this.persona = persona;
        this.mode = mode;
        this.status = SessionStatus.READY;
    }

    // 그룹 면접 참가자의 면접(API 명세 10.1 · 10.3). 면접 방식 · 면접관은 그룹 값이다
    public static InterviewSession ofGroup(
            User user,
            Application application,
            CompanyCard companyCard,
            Persona persona,
            InterviewMode mode,
            long groupId) {
        InterviewSession session =
                new InterviewSession(user, application, companyCard, persona, mode);
        session.groupId = groupId;
        return session;
    }

    // 5.4. 면접 플랜 준비 여부(Redis)는 서비스가 먼저 확인한다. 배정 거절(START_FAILED) 뒤에도 같은 플랜으로 다시 시작한다
    public void start(OffsetDateTime now) {
        if (!canStart()) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
        this.status = SessionStatus.IN_PROGRESS;
        this.startedAt = now;
    }

    public boolean canStart() {
        return status == SessionStatus.READY || status == SessionStatus.START_FAILED;
    }

    // 에이전트가 배정을 거절했거나 면접관이 첫 질문을 시작하지 못함(AI 명세 1.4 · 6.5). 질문을 내기 전인지는 부르는 쪽이 확인한다
    public void failStart() {
        requireStatus(SessionStatus.IN_PROGRESS);
        this.status = SessionStatus.START_FAILED;
    }

    // 5.8. 답변이 있으면 결과 생성(ANALYZING), 없으면 결과 없이 종료(ABORTED). 연습으로 인정되면 true
    public boolean end(OffsetDateTime now, int answeredCount) {
        return end(now, answeredCount, null);
    }

    // 그룹 세션은 끝난 이유를 남긴다(docs/그룹면접-설계.md 6.10)
    public boolean end(OffsetDateTime now, int answeredCount, EndReason reason) {
        requireStatus(SessionStatus.IN_PROGRESS);
        this.endReason = reason;
        this.endedAt = now;
        this.status = answeredCount > 0 ? SessionStatus.ANALYZING : SessionStatus.ABORTED;
        return answeredCount > 0;
    }

    // 결과 생성 완료
    public void complete(String headline, String summary) {
        requireStatus(SessionStatus.ANALYZING);
        this.headline = headline;
        this.summary = summary;
        this.status = SessionStatus.COMPLETED;
    }

    // 결과 생성 실패
    public void failAnalysis() {
        requireStatus(SessionStatus.ANALYZING);
        this.status = SessionStatus.FAILED;
    }

    // 5.9
    public void retryAnalysis() {
        requireStatus(SessionStatus.FAILED);
        this.status = SessionStatus.ANALYZING;
    }

    public boolean isGroup() {
        return groupId != null;
    }

    public boolean isVideo() {
        return mode == InterviewMode.VIDEO;
    }

    public boolean isOwnedBy(long userId) {
        return user.getId() == userId;
    }

    private void requireStatus(SessionStatus expected) {
        if (status != expected) {
            throw new ApiException(ErrorCode.INVALID_SESSION_STATE);
        }
    }
}
