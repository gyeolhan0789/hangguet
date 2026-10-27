package com.ssafy.a301.admin.service;

import com.ssafy.a301.admin.domain.AdminDailyMetric;
import com.ssafy.a301.admin.dto.AdminDtos.AdminMetricsResponse;
import com.ssafy.a301.admin.dto.AdminDtos.DailyMetricItem;
import com.ssafy.a301.admin.dto.AdminDtos.DailyMetricsResponse;
import com.ssafy.a301.admin.dto.AdminDtos.InterviewMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.UserMetrics;
import com.ssafy.a301.admin.repository.AdminDailyMetricRepository;
import com.ssafy.a301.common.time.KoreaTime;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 8.16 관리자 일별 메트릭. 0시(한국 시간)에 전날 집계(8.15)를 한 행으로 남기고 기간으로 조회한다. */
@Service
public class AdminDailyMetricService {

    private final AdminMetricsService metrics;
    private final AdminDailyMetricRepository daily;

    public AdminDailyMetricService(AdminMetricsService metrics, AdminDailyMetricRepository daily) {
        this.metrics = metrics;
        this.daily = daily;
    }

    /** date의 집계를 now 시각으로 남긴다. 이미 있으면 덮어쓴다 */
    @Transactional
    public void record(LocalDate date, OffsetDateTime now) {
        AdminMetricsResponse m = metrics.metrics(date, now);
        AdminDailyMetric row = new AdminDailyMetric(date, now);
        UserMetrics users = m.users();
        row.users(users.total(), users.joinedToday(), users.withdrawn(), users.interviewed());
        row.practice(m.practice().practicedToday(), m.practice().practicedWeek());
        m.practice().retention().forEach(r -> row.retention(r.days(), r.eligible(), r.returned()));
        InterviewMetrics interviews = m.interviews();
        row.interviews(
                interviews.total(),
                interviews.completed(),
                interviews.failed(),
                interviews.aborted(),
                interviews.stuck());
        row.others(
                m.applications(),
                m.inquiries().waiting(),
                m.streakFreezes().granted(),
                m.streakFreezes().used());
        daily.save(row);
    }

    /** 0시에 서버가 꺼져 있었으면 기동할 때 전날 기록을 채운다. 이미 있으면 그대로 둔다(0시에 잰 값을 지키려고) */
    @Transactional
    public boolean recordYesterdayIfAbsent(OffsetDateTime now) {
        LocalDate yesterday = KoreaTime.dateOf(now).minusDays(1);
        if (daily.existsById(yesterday)) {
            return false;
        }
        record(yesterday, now);
        return true;
    }

    /** 어제까지 최근 days일의 기록. 기록이 없는 날은 빠진다 */
    @Transactional(readOnly = true)
    public DailyMetricsResponse recent(int days) {
        LocalDate to = KoreaTime.today().minusDays(1);
        LocalDate from = to.minusDays(days - 1L);
        return new DailyMetricsResponse(
                from,
                to,
                daily.findByMetricDateBetweenOrderByMetricDateAsc(from, to).stream()
                        .map(AdminDailyMetricService::item)
                        .toList());
    }

    private static DailyMetricItem item(AdminDailyMetric d) {
        return new DailyMetricItem(
                d.getMetricDate(),
                d.getUsersTotal(),
                d.getUsersJoined(),
                d.getUsersWithdrawn(),
                d.getUsersInterviewed(),
                d.getPracticedUsers(),
                d.getPracticedWeek(),
                d.getD1Eligible(),
                d.getD1Returned(),
                d.getD3Eligible(),
                d.getD3Returned(),
                d.getD7Eligible(),
                d.getD7Returned(),
                d.getInterviewsTotal(),
                d.getInterviewsCompleted(),
                d.getInterviewsFailed(),
                d.getInterviewsAborted(),
                d.getInterviewsStuck(),
                d.getApplications(),
                d.getInquiriesWaiting(),
                d.getFreezesGranted(),
                d.getFreezesUsed(),
                d.getRecordedAt());
    }
}
