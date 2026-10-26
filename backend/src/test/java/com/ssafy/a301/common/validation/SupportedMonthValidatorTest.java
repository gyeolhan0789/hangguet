package com.ssafy.a301.common.validation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class SupportedMonthValidatorTest {
    private final SupportedMonthValidator validator = new SupportedMonthValidator();

    @Test
    void acceptsYyyyMmFromYearOneToNineThousandNineHundredNinetyNine() {
        for (String month : List.of("0001-01", "2026-10", "9999-12")) {
            assertThat(validator.isValid(month, null)).as(month).isTrue();
        }
    }

    @Test
    void rejectsOtherFormatsAndYearZero() {
        for (String month :
                List.of("0000-01", "2026-00", "2026-13", "2026-2", "2026-02-01", "+10000-01", "")) {
            assertThat(validator.isValid(month, null)).as(month).isFalse();
        }
    }

    @Test
    void leavesRequiredCheckToRequestParam() {
        assertThat(validator.isValid(null, null)).isTrue();
    }
}
