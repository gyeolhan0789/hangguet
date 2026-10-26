package com.ssafy.a301.common.validation;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class SupportedDateValidatorTest {
    private final SupportedDateValidator validator = new SupportedDateValidator();

    @Test
    void acceptsFourDigitYearsIncludingBoundaries() {
        assertThat(validator.isValid(LocalDate.of(1, 1, 1), null)).isTrue();
        assertThat(validator.isValid(LocalDate.of(2026, 10, 21), null)).isTrue();
        assertThat(validator.isValid(LocalDate.of(9999, 12, 31), null)).isTrue();
    }

    @Test
    void rejectsYearZeroNegativeAndFiveDigitYears() {
        assertThat(validator.isValid(LocalDate.of(0, 12, 31), null)).isFalse();
        assertThat(validator.isValid(LocalDate.of(10000, 1, 1), null)).isFalse();
        assertThat(validator.isValid(LocalDate.MIN, null)).isFalse();
        assertThat(validator.isValid(LocalDate.MAX, null)).isFalse();
    }

    @Test
    void leavesRequiredCheckToRequestParam() {
        assertThat(validator.isValid(null, null)).isTrue();
    }
}
