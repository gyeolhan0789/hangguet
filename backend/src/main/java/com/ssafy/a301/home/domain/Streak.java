package com.ssafy.a301.home.domain;

import java.time.LocalDate;
import java.util.Collection;
import java.util.HashSet;
import java.util.Set;

/** 스트릭 계산(BE 설계 6.1). 연습한 날은 practice_logs에 있는 날이다. */
public final class Streak {

    private Streak() {}

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
}
