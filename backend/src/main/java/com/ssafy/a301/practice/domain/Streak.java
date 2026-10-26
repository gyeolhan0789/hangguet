package com.ssafy.a301.practice.domain;

import java.time.LocalDate;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** 스트릭 계산(BE 설계 6.1). 연습한 날은 practice_logs에 있는 날이다. */
public final class Streak {

    private Streak() {}

    /** 뱃지 구간 0 / 1–2 / 3–5 / 6–7 / 8–13 / 14+일을 0~5로 준다(BE 설계 6.1). 구간이 바뀌면 레벨업이다 */
    public static int badgeLevel(int streak) {
        if (streak >= 14) {
            return 5;
        }
        if (streak >= 8) {
            return 4;
        }
        if (streak >= 6) {
            return 3;
        }
        if (streak >= 3) {
            return 2;
        }
        return streak >= 1 ? 1 : 0;
    }

    /** 오늘 기록이 있으면 오늘부터, 없으면 어제부터 거꾸로 빠짐없이 이어진 날 수. 어제도 없으면 0 */
    public static int current(Collection<LocalDate> practiceDates, LocalDate today) {
        Set<LocalDate> days = new HashSet<>(practiceDates);
        LocalDate day = days.contains(today) ? today : today.minusDays(1);
        int streak = 0;
        while (days.contains(day)) {
            streak++;
            day = day.minusDays(1);
        }
        return streak;
    }

    /** 전체 기록에서 가장 길게 이어진 날 수. 기록이 없으면 0 */
    public static int best(Collection<LocalDate> practiceDates) {
        List<LocalDate> days = practiceDates.stream().distinct().sorted().toList();
        int best = 0;
        int streak = 0;
        LocalDate previous = null;
        for (LocalDate day : days) {
            streak = day.minusDays(1).equals(previous) ? streak + 1 : 1;
            best = Math.max(best, streak);
            previous = day;
        }
        return best;
    }
}
