package com.ssafy.a301.common.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 조회 월은 YYYY-MM 형식, 0001-01~9999-12만 받는다(5.15·3.3). 통과한 값은 YearMonth.parse로 읽을 수 있다. null은 통과시키고 필수
 * 여부는 @RequestParam 등이 정한다.
 */
@Documented
@Constraint(validatedBy = SupportedMonthValidator.class)
@Target({ElementType.PARAMETER, ElementType.FIELD})
@Retention(RetentionPolicy.RUNTIME)
public @interface SupportedMonth {
    String message() default "YYYY-MM 형식입니다.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
