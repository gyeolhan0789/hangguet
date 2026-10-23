package com.ssafy.a301.home.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class StreakTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 20);

    @Test
    void countsFromTodayWhenPracticedToday() {
        assertThat(Streak.current(List.of(TODAY, TODAY.minusDays(1), TODAY.minusDays(2)), TODAY))
                .isEqualTo(3);
    }

    @Test
    void countsFromYesterdayWhenNotPracticedToday() {
        assertThat(Streak.current(List.of(TODAY.minusDays(2), TODAY.minusDays(1)), TODAY))
                .isEqualTo(2);
    }

    @Test
    void stopsAtFirstMissingDay() {
        assertThat(Streak.current(List.of(TODAY, TODAY.minusDays(2)), TODAY)).isEqualTo(1);
    }

    @Test
    void badgeLevelChangesAtOneThreeSixEightFourteenDays() {
        int[] levels = new int[16];
        for (int streak = 0; streak < levels.length; streak++) {
            levels[streak] = Streak.badgeLevel(streak);
        }
        assertThat(levels).containsExactly(0, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4, 5, 5);
    }

    @Test
    void bestIsLongestRunInWholeHistory() {
        List<LocalDate> days =
                List.of(
                        TODAY,
                        TODAY.minusDays(5),
                        TODAY.minusDays(6),
                        TODAY.minusDays(7),
                        TODAY.minusDays(9),
                        TODAY.minusDays(10));
        assertThat(Streak.best(days)).isEqualTo(3);
        assertThat(Streak.current(days, TODAY)).isEqualTo(1);
    }

    @Test
    void bestIgnoresOrderAndDuplicatesAndCrossesMonthBoundary() {
        LocalDate monthEnd = LocalDate.of(2026, 9, 30);
        assertThat(
                        Streak.best(
                                List.of(
                                        monthEnd.plusDays(1),
                                        monthEnd,
                                        monthEnd,
                                        monthEnd.minusDays(1))))
                .isEqualTo(3);
    }

    @Test
    void bestIsZeroWithoutRecords() {
        assertThat(Streak.best(List.of())).isZero();
    }

    @Test
    void isZeroWhenYesterdayIsMissing() {
        assertThat(Streak.current(List.of(TODAY.minusDays(2)), TODAY)).isZero();
        assertThat(Streak.current(List.of(), TODAY)).isZero();
    }
}
