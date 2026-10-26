package com.ssafy.a301.home.service;

import com.ssafy.a301.growth.service.GrowthReviewService;
import com.ssafy.a301.growth.service.GrowthReviewService.HomeReviews;
import com.ssafy.a301.home.dto.HomeDtos.HomeResponse;
import com.ssafy.a301.home.dto.HomeDtos.HomeState;
import com.ssafy.a301.home.service.PracticeStatsService.DailyPractice;
import com.ssafy.a301.home.service.PracticeStatsService.Streaks;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 3.1 홈. 값은 새로 계산하지 않고 스트릭·최근 7일·오늘 면접 수와 시간은 PracticeStatsService(3.2와 같음), 성장 리뷰 값은
 * GrowthReviewService(7.1·7.2와 같음)에서 가져온다.
 */
@Service
public class HomeService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final PracticeStatsService practiceStats;
    private final GrowthReviewService growthReviews;

    public HomeService(PracticeStatsService practiceStats, GrowthReviewService growthReviews) {
        this.practiceStats = practiceStats;
        this.growthReviews = growthReviews;
    }

    // 아래 home(userId, today)를 같은 객체 안에서 부르면 그쪽 @Transactional이 적용되지 않으므로 여기에도 둔다
    @Transactional(readOnly = true)
    public HomeResponse home(long userId) {
        return home(userId, LocalDate.now(KST));
    }

    @Transactional(readOnly = true)
    public HomeResponse home(long userId, LocalDate today) {
        Streaks streaks = practiceStats.streaks(userId, today);
        List<LocalDate> practiceDates = practiceStats.recentPracticeDates(userId, today);
        DailyPractice todayPractice = practiceStats.daily(userId, today);
        HomeReviews reviews = growthReviews.homeReviews(userId, today);
        return new HomeResponse(
                homeState(streaks, practiceDates, today),
                streaks.current(),
                streaks.best(),
                practiceDates,
                todayPractice.interviewCount(),
                todayPractice.practiceMinutes(),
                reviews.todayImprovements(),
                reviews.nextActions(),
                reviews.nextActionsDate(),
                reviews.recentReviews());
    }

    /** 기록 없음 FIRST_VISIT / 오늘 기록 DONE_TODAY / 어제 기록 NOT_DONE_TODAY / 그 외 BROKEN(BE 설계 6.1) */
    private static HomeState homeState(
            Streaks streaks, List<LocalDate> recentPracticeDates, LocalDate today) {
        if (streaks.best() == 0) {
            return HomeState.FIRST_VISIT;
        }
        if (recentPracticeDates.contains(today)) {
            return HomeState.DONE_TODAY;
        }
        return recentPracticeDates.contains(today.minusDays(1))
                ? HomeState.NOT_DONE_TODAY
                : HomeState.BROKEN;
    }
}
