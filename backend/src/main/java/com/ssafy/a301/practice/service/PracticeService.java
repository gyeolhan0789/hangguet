package com.ssafy.a301.practice.service;

import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.practice.domain.PracticeLog;
import com.ssafy.a301.practice.domain.Streak;
import com.ssafy.a301.practice.repository.PracticeLogRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 연습한 날(practice_logs)과 스트릭(BE 설계 6.1). 연습 기록은 이 서비스로만 넣고(5.8 면접 끝내기, 8.14 유지권), 스트릭도 여기서만 계산한다.
 * 홈·통계 (3.x)·성장 리뷰(7.x)·회원(2.x)·유지권(8.x)이 함께 쓴다.
 */
@Service
public class PracticeService {
    private static final int RECENT_DAYS = 7;

    private final PracticeLogRepository practiceLogs;

    public PracticeService(PracticeLogRepository practiceLogs) {
        this.practiceLogs = practiceLogs;
    }

    /** 현재·최장 스트릭 */
    public record Streaks(int current, int best) {}

    @Transactional(readOnly = true)
    public Streaks streaks(long userId, LocalDate today) {
        List<LocalDate> practiceDates = practiceLogs.findPracticeDatesByUserId(userId);
        return new Streaks(Streak.current(practiceDates, today), Streak.best(practiceDates));
    }

    /** 한국 시간 오늘 기준 현재 스트릭 */
    @Transactional(readOnly = true)
    public int currentStreak(long userId) {
        return Streak.current(practiceLogs.findPracticeDatesByUserId(userId), KoreaTime.today());
    }

    /** 그날 포함 최근 7일 중 연습한 날, 날짜 오름차순 */
    @Transactional(readOnly = true)
    public List<LocalDate> recentPracticeDates(long userId, LocalDate date) {
        return logsBetween(userId, date.minusDays(RECENT_DAYS - 1L), date.plusDays(1)).stream()
                .map(PracticeLog::getPracticeDate)
                .toList();
    }

    /** from 이상 to 미만의 연습 기록, 날짜 오름차순 */
    @Transactional(readOnly = true)
    public List<PracticeLog> logsBetween(long userId, LocalDate from, LocalDate to) {
        return practiceLogs.findInRange(userId, from, to);
    }

    /** 그날 처음일 때만 연습 기록을 남긴다. 남겼으면 true(이미 있으면 false) */
    @Transactional
    public boolean record(long userId, LocalDate practiceDate) {
        return practiceLogs.insertIfAbsent(userId, practiceDate) > 0;
    }

    /** 5.8. 연습 기록을 남기고, 이번에 남겨 오늘 기준 스트릭 뱃지 구간이 바뀌었으면 true(레벨업) */
    @Transactional
    public boolean recordAndCheckLevelUp(long userId, LocalDate practiceDate, LocalDate today) {
        List<LocalDate> before = practiceLogs.findPracticeDatesByUserId(userId);
        if (!record(userId, practiceDate)) {
            return false;
        }
        List<LocalDate> after = new ArrayList<>(before);
        after.add(practiceDate);
        return Streak.badgeLevel(Streak.current(before, today))
                != Streak.badgeLevel(Streak.current(after, today));
    }
}
