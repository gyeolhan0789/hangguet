package com.ssafy.a301.common.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import java.time.LocalDate;

public class SupportedDateValidator implements ConstraintValidator<SupportedDate, LocalDate> {
    static final LocalDate MIN = LocalDate.of(SupportedMonthValidator.MIN_YEAR, 1, 1);
    static final LocalDate MAX = LocalDate.of(SupportedMonthValidator.MAX_YEAR, 12, 31);

    @Override
    public boolean isValid(LocalDate value, ConstraintValidatorContext context) {
        return value == null || (!value.isBefore(MIN) && !value.isAfter(MAX));
    }
}
