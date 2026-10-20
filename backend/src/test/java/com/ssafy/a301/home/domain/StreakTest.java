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
    void isZeroWhenYesterdayIsMissing() {
        assertThat(Streak.current(List.of(TODAY.minusDays(2)), TODAY)).isZero();
        assertThat(Streak.current(List.of(), TODAY)).isZero();
    }
}
