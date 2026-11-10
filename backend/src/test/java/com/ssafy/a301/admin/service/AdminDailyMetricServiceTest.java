package com.ssafy.a301.admin.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.admin.domain.AdminDailyMetric;
import com.ssafy.a301.admin.dto.AdminDtos.AdminMetricsResponse;
import com.ssafy.a301.admin.dto.AdminDtos.InquiryMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.InterviewMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.PracticeMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.Retention;
import com.ssafy.a301.admin.dto.AdminDtos.SpeechAverages;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeMetrics;
import com.ssafy.a301.admin.dto.AdminDtos.UserMetrics;
import com.ssafy.a301.admin.repository.AdminDailyMetricRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

/** 8.16 기록이 8.15 집계의 각 값을 제 칸에 넣는지, 기동 때 채우기 · 조회 기간이 맞는지 본다. 칸마다 다른 값을 넣어 두 칸이 바뀌면 깨진다. */
class AdminDailyMetricServiceTest {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final LocalDate DAY = LocalDate.of(2026, 10, 25);
    private static final OffsetDateTime NOW =
            OffsetDateTime.of(
                    2026, 10, 26, 0, 0, 3, 0, KST.getRules().getOffset(DAY.atStartOfDay()));

    private final AdminMetricsService metrics = mock(AdminMetricsService.class);
    private final AdminDailyMetricRepository daily = mock(AdminDailyMetricRepository.class);
    private final AdminDailyMetricService service = new AdminDailyMetricService(metrics, daily);

    @Test
    void recordPutsEachAggregateIntoItsOwnColumn() {
        when(metrics.metrics(DAY, NOW)).thenReturn(response());

        service.recordDay(DAY, NOW);

        AdminDailyMetric row = saved();
        assertThat(row.getMetricDate()).isEqualTo(DAY);
        assertThat(row.getRecordedAt()).isEqualTo(NOW);
        assertThat(row.getUsersTotal()).isEqualTo(1);
        assertThat(row.getUsersJoined()).isEqualTo(2);
        assertThat(row.getUsersWithdrawn()).isEqualTo(3);
        assertThat(row.getUsersInterviewed()).isEqualTo(4);
        assertThat(row.getPracticedUsers()).isEqualTo(5);
        assertThat(row.getPracticedWeek()).isEqualTo(6);
        assertThat(row.getD1Eligible()).isEqualTo(7);
        assertThat(row.getD1Returned()).isEqualTo(8);
        assertThat(row.getD3Eligible()).isEqualTo(9);
        assertThat(row.getD3Returned()).isEqualTo(10);
        assertThat(row.getD7Eligible()).isEqualTo(11);
        assertThat(row.getD7Returned()).isEqualTo(12);
        assertThat(row.getInterviewsTotal()).isEqualTo(13);
        assertThat(row.getInterviewsCompleted()).isEqualTo(14);
        assertThat(row.getInterviewsFailed()).isEqualTo(15);
        assertThat(row.getInterviewsAborted()).isEqualTo(16);
        assertThat(row.getInterviewsStuck()).isEqualTo(17);
        assertThat(row.getApplications()).isEqualTo(18);
        assertThat(row.getInquiriesWaiting()).isEqualTo(19);
        assertThat(row.getFreezesGranted()).isEqualTo(20);
        assertThat(row.getFreezesUsed()).isEqualTo(21);
    }

    @Test
    void startupFillRecordsYesterdayOnlyWhenAbsent() {
        LocalDate yesterday = NOW.toLocalDate().minusDays(1);
        when(metrics.metrics(yesterday, NOW)).thenReturn(response());

        when(daily.existsById(yesterday)).thenReturn(true);
        assertThat(service.recordYesterdayIfAbsent(NOW)).isFalse();
        verify(daily, never()).save(any());

        when(daily.existsById(yesterday)).thenReturn(false);
        assertThat(service.recordYesterdayIfAbsent(NOW)).isTrue();
        assertThat(saved().getMetricDate()).isEqualTo(yesterday);
    }

    // 한국 날짜로 바꾼 뒤 하루 전이다. UTC로는 아직 전날(10.25 15:00)이라 시간대를 빼면 10.24가 된다
    @Test
    void startupFillUsesKoreanDateOfNow() {
        OffsetDateTime utc = NOW.withOffsetSameInstant(java.time.ZoneOffset.UTC);
        when(daily.existsById(DAY)).thenReturn(true);

        assertThat(service.recordYesterdayIfAbsent(utc)).isFalse();
        verify(daily).existsById(DAY);
    }

    @Test
    void recentReadsUpToYesterdayForDays() {
        LocalDate today = LocalDate.now(KST);
        when(daily.findByMetricDateBetweenOrderByMetricDateAsc(
                        today.minusDays(30), today.minusDays(1)))
                .thenReturn(List.of());

        var res = service.recent(30);

        assertThat(res.from()).isEqualTo(today.minusDays(30));
        assertThat(res.to()).isEqualTo(today.minusDays(1));
        verify(daily)
                .findByMetricDateBetweenOrderByMetricDateAsc(
                        today.minusDays(30), today.minusDays(1));
    }

    private AdminDailyMetric saved() {
        ArgumentCaptor<AdminDailyMetric> captor = ArgumentCaptor.forClass(AdminDailyMetric.class);
        verify(daily).save(captor.capture());
        return captor.getValue();
    }

    // 칸마다 다른 값. 기록에 남기지 않는 값(분석 중 · 방식 · 만료, 14일 재방문)은 90 이상으로 둔다
    private static AdminMetricsResponse response() {
        return new AdminMetricsResponse(
                DAY,
                new UserMetrics(1, 2, 3, 4),
                new PracticeMetrics(
                        5,
                        6,
                        List.of(),
                        List.of(
                                new Retention(1, 7, 8),
                                new Retention(3, 9, 10),
                                new Retention(7, 11, 12),
                                new Retention(14, 90, 91))),
                new InterviewMetrics(13, 14, 99, 15, 16, 97, 96, 17, List.of()),
                List.of(),
                new SpeechAverages(0, null, null, null, null, null, null),
                18,
                new InquiryMetrics(19),
                new StreakFreezeMetrics(20, 21, 98),
                List.of());
    }
}
