package com.ssafy.a301.home.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.service.InterviewStatsService;
import com.ssafy.a301.practice.repository.PracticeLogRepository;
import com.ssafy.a301.practice.service.PracticeService;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.domain.Limit;

@ExtendWith(MockitoExtension.class)
class PracticeStatsServiceTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 20);

    @Mock private PracticeLogRepository practiceLogs;
    @Mock private InterviewSessionRepository sessions;

    @Test
    void statsCombinesStreaksCountsMinutesAndLatestJobTitle() {
        when(practiceLogs.findPracticeDatesByUserId(7))
                .thenReturn(
                        List.of(
                                TODAY.minusDays(1),
                                TODAY.minusDays(2),
                                TODAY.minusDays(5),
                                TODAY.minusDays(6),
                                TODAY.minusDays(7),
                                TODAY.minusDays(8)));
        when(sessions.countPracticeSessions(7, SessionStatus.PRACTICE)).thenReturn(6L);
        when(sessions.sumPracticeSeconds(7, SessionStatus.practiceNames())).thenReturn(24_059L);
        when(sessions.findPracticeJobTitles(7, SessionStatus.PRACTICE, Limit.of(1)))
                .thenReturn(List.of("백엔드 개발자"));

        var stats = service().stats(7, TODAY);

        assertThat(stats.currentStreak()).isEqualTo(2);
        assertThat(stats.bestStreak()).isEqualTo(4);
        assertThat(stats.totalInterviewCount()).isEqualTo(6);
        assertThat(stats.totalPracticeMinutes()).isEqualTo(400);
        assertThat(stats.latestJobTitle()).isEqualTo("백엔드 개발자");
    }

    @Test
    void statsIsZeroAndNullWithoutRecords() {
        when(practiceLogs.findPracticeDatesByUserId(7)).thenReturn(List.of());
        when(sessions.findPracticeJobTitles(eq(7L), any(), any())).thenReturn(List.of());

        var stats = service().stats(7, TODAY);

        assertThat(stats.currentStreak()).isZero();
        assertThat(stats.bestStreak()).isZero();
        assertThat(stats.totalInterviewCount()).isZero();
        assertThat(stats.totalPracticeMinutes()).isZero();
        assertThat(stats.latestJobTitle()).isNull();
    }

    @Test
    void currentStreakIsZeroWhenBrokenButBestKeepsHistory() {
        when(practiceLogs.findPracticeDatesByUserId(7))
                .thenReturn(List.of(TODAY.minusDays(2), TODAY.minusDays(3), TODAY.minusDays(4)));

        var streaks = new PracticeService(practiceLogs).streaks(7, TODAY);

        assertThat(streaks.current()).isZero();
        assertThat(streaks.best()).isEqualTo(3);
    }

    @Test
    void practiceLogsQueriesFromFirstDayUntilNextMonth() {
        when(practiceLogs.findInRange(anyLong(), any(), any())).thenReturn(List.of());

        var logs = service().practiceLogs(7, YearMonth.of(2028, 2));

        assertThat(logs.content()).isEmpty();
        verify(practiceLogs).findInRange(7, LocalDate.of(2028, 2, 1), LocalDate.of(2028, 3, 1));
    }

    private PracticeStatsService service() {
        return new PracticeStatsService(
                new PracticeService(practiceLogs), new InterviewStatsService(sessions));
    }
}
