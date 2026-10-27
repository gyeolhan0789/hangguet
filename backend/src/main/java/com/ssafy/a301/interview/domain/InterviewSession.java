package com.ssafy.a301.interview.domain;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
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

    @Column(name = "started_at")
    private OffsetDateTime startedAt;

    @Column(name = "ended_at")
    private OffsetDateTime endedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public InterviewSession(
            User user, Application application, Persona persona, InterviewMode mode) {
        this.user = user;
        this.application = application;
        this.persona = persona;
        this.mode = mode;
        this.status = SessionStatus.READY;
    }

    // 5.4. 면접 플랜 준비 여부(Redis)는 서비스가 먼저 확인한다
    public void start(OffsetDateTime now) {
        requireStatus(SessionStatus.READY);
        this.status = SessionStatus.IN_PROGRESS;
        this.startedAt = now;
    }

    // 5.8. 답변이 있으면 결과 생성(ANALYZING), 없으면 결과 없이 종료(ABORTED). 연습으로 인정되면 true
    public boolean end(OffsetDateTime now, int answeredCount) {
        requireStatus(SessionStatus.IN_PROGRESS);
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
