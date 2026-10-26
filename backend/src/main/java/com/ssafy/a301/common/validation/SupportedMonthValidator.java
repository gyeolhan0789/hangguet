package com.ssafy.a301.common.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import java.util.regex.Pattern;

public class SupportedMonthValidator implements ConstraintValidator<SupportedMonth, String> {
    static final int MIN_YEAR = 1;
    static final int MAX_YEAR = 9999;
    private static final Pattern MONTH = Pattern.compile("(?!0000)[0-9]{4}-(0[1-9]|1[0-2])");

    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        return value == null || MONTH.matcher(value).matches();
    }
}
