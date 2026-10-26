package com.ssafy.a301.home.mapper;

import com.ssafy.a301.growth.service.GrowthReviewService.HomeReviews;
import com.ssafy.a301.home.dto.HomeDtos.HomeResponse;
import com.ssafy.a301.home.dto.HomeDtos.HomeState;
import com.ssafy.a301.home.dto.HomeDtos.PracticeLogItem;
import com.ssafy.a301.home.dto.HomeDtos.PracticeLogsResponse;
import com.ssafy.a301.interview.service.InterviewStatsService.DailyPractice;
import com.ssafy.a301.practice.domain.PracticeLog;
import com.ssafy.a301.practice.service.PracticeService.Streaks;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;

/** 연습 기록 엔티티 → 연습 달력 응답, 서비스가 계산한 값 → 홈 응답 */
public final class HomeMapper {

    private HomeMapper() {}

    public static PracticeLogsResponse toPracticeLogs(List<PracticeLog> logs) {
        return new PracticeLogsResponse(
                logs.stream()
                        .sorted(Comparator.comparing(PracticeLog::getPracticeDate))
                        .map(l -> new PracticeLogItem(l.getPracticeDate(), l.getCreatedAt()))
                        .toList());
    }

    public static HomeResponse toHomeResponse(
            HomeState state,
            Streaks streaks,
            List<LocalDate> recentPracticeDates,
            DailyPractice todayPractice,
            HomeReviews reviews) {
        return new HomeResponse(
                state,
                streaks.current(),
                streaks.best(),
                recentPracticeDates,
                todayPractice.interviewCount(),
                todayPractice.practiceMinutes(),
                reviews.todayImprovements(),
                reviews.nextActions(),
                reviews.nextActionsDate(),
                reviews.recentReviews());
    }
}
