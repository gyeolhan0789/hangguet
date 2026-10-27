package com.ssafy.a301.admin.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * 관리자 일별 메트릭(8.16). 8.15 집계를 하루 한 행으로 남긴다. 날짜로 정해지는 값(가입 · 연습 · 재방문)은 metricDate 기준, 상태가 바뀌는 값(회원 ·
 * 면접 · 문의 · 유지권 수)은 recordedAt 시각 기준이다. 비율 대신 분자 · 분모를 둔다.
 */
@Entity
@Table(name = "admin_daily_metrics")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class AdminDailyMetric {

    @Id
    @Column(name = "metric_date")
    private LocalDate metricDate;

    @Column(name = "users_total", nullable = false)
    private int usersTotal;

    @Column(name = "users_joined", nullable = false)
    private int usersJoined;

    @Column(name = "users_withdrawn", nullable = false)
    private int usersWithdrawn;

    @Column(name = "users_interviewed", nullable = false)
    private int usersInterviewed;

    @Column(name = "practiced_users", nullable = false)
    private int practicedUsers;

    @Column(name = "practiced_week", nullable = false)
    private int practicedWeek;

    @Column(name = "d1_eligible", nullable = false)
    private int d1Eligible;

    @Column(name = "d1_returned", nullable = false)
    private int d1Returned;

    @Column(name = "d3_eligible", nullable = false)
    private int d3Eligible;

    @Column(name = "d3_returned", nullable = false)
    private int d3Returned;

    @Column(name = "d7_eligible", nullable = false)
    private int d7Eligible;

    @Column(name = "d7_returned", nullable = false)
    private int d7Returned;

    @Column(name = "interviews_total", nullable = false)
    private int interviewsTotal;

    @Column(name = "interviews_completed", nullable = false)
    private int interviewsCompleted;

    @Column(name = "interviews_failed", nullable = false)
    private int interviewsFailed;

    @Column(name = "interviews_aborted", nullable = false)
    private int interviewsAborted;

    @Column(name = "interviews_stuck", nullable = false)
    private int interviewsStuck;

    @Column(nullable = false)
    private int applications;

    @Column(name = "inquiries_waiting", nullable = false)
    private int inquiriesWaiting;

    @Column(name = "freezes_granted", nullable = false)
    private int freezesGranted;

    @Column(name = "freezes_used", nullable = false)
    private int freezesUsed;

    @Column(name = "recorded_at", nullable = false)
    private OffsetDateTime recordedAt;

    public AdminDailyMetric(LocalDate metricDate, OffsetDateTime recordedAt) {
        this.metricDate = metricDate;
        this.recordedAt = recordedAt;
    }

    public void users(int total, int joined, int withdrawn, int interviewed) {
        this.usersTotal = total;
        this.usersJoined = joined;
        this.usersWithdrawn = withdrawn;
        this.usersInterviewed = interviewed;
    }

    public void practice(int users, int week) {
        this.practicedUsers = users;
        this.practicedWeek = week;
    }

    /** days(1 · 3 · 7)일째 재방문. 다른 날은 무시한다 */
    public void retention(int days, int eligible, int returned) {
        switch (days) {
            case 1 -> {
                this.d1Eligible = eligible;
                this.d1Returned = returned;
            }
            case 3 -> {
                this.d3Eligible = eligible;
                this.d3Returned = returned;
            }
            case 7 -> {
                this.d7Eligible = eligible;
                this.d7Returned = returned;
            }
            default -> {
                // 일별 기록은 1 · 3 · 7일만 남긴다
            }
        }
    }

    public void interviews(int total, int completed, int failed, int aborted, int stuck) {
        this.interviewsTotal = total;
        this.interviewsCompleted = completed;
        this.interviewsFailed = failed;
        this.interviewsAborted = aborted;
        this.interviewsStuck = stuck;
    }

    public void others(
            int applications, int inquiriesWaiting, int freezesGranted, int freezesUsed) {
        this.applications = applications;
        this.inquiriesWaiting = inquiriesWaiting;
        this.freezesGranted = freezesGranted;
        this.freezesUsed = freezesUsed;
    }
}
