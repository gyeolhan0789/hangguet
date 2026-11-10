package com.ssafy.a301.home.service;

import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.home.dto.HomeDtos.PracticeLogsResponse;
import com.ssafy.a301.home.dto.HomeDtos.StatsResponse;
import com.ssafy.a301.home.mapper.HomeMapper;
import com.ssafy.a301.interview.service.InterviewStatsService;
import com.ssafy.a301.interview.service.InterviewStatsService.Totals;
import com.ssafy.a301.practice.service.PracticeService;
import com.ssafy.a301.practice.service.PracticeService.Streaks;
import java.time.LocalDate;
import java.time.YearMonth;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 3.2 통계·3.3 연습 달력. 연습한 날·스트릭은 PracticeService(practice_logs), 면접 수·시간·직무는 InterviewStatsService(연습
 * 면접)로 계산한다(BE 설계 6.1).
 */
@Service
public class PracticeStatsService {

    private final PracticeService practices;
    private final InterviewStatsService interviewStats;

    public PracticeStatsService(PracticeService practices, InterviewStatsService interviewStats) {
        this.practices = practices;
        this.interviewStats = interviewStats;
    }

    @Transactional(readOnly = true)
    public StatsResponse stats(long userId) {
        return build(userId, KoreaTime.today());
    }

    @Transactional(readOnly = true)
    public StatsResponse stats(long userId, LocalDate today) {
        return build(userId, today);
    }

    private StatsResponse build(long userId, LocalDate today) {
        Streaks streaks = practices.streaks(userId, today);
        Totals totals = interviewStats.totals(userId);
        return new StatsResponse(
                streaks.current(),
                streaks.best(),
                totals.interviewCount(),
                totals.practiceMinutes(),
                totals.latestJobTitle());
    }

    @Transactional(readOnly = true)
    public PracticeLogsResponse practiceLogs(long userId, YearMonth month) {
        return HomeMapper.toPracticeLogs(
                practices.logsBetween(userId, month.atDay(1), month.plusMonths(1).atDay(1)));
    }
}
