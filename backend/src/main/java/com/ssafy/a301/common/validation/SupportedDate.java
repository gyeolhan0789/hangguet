package com.ssafy.a301.common.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 조회 날짜(YYYY-MM-DD)는 0001-01-01~9999-12-31만 받는다(5.15 월 범위와 같음). ISO 날짜는 0000년·다섯 자리 연도도 읽어서, 막지 않으면
 * 시각 계산·DB에서 500이 된다. null은 통과시키고 필수 여부는 @RequestParam 등이 정한다.
 */
@Documented
@Constraint(validatedBy = SupportedDateValidator.class)
@Target({ElementType.PARAMETER, ElementType.FIELD})
@Retention(RetentionPolicy.RUNTIME)
public @interface SupportedDate {
    String message() default "0001-01-01~9999-12-31입니다.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
