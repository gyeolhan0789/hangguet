package com.ssafy.a301.common.web;

import io.swagger.v3.oas.annotations.Parameter;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.security.core.annotation.AuthenticationPrincipal;

/** 로그인한 회원 id(회원 액세스 토큰의 sub). 컨트롤러 인자에 붙인다. 토큰 없이 부르는 API(9.x 비회원)에는 쓰지 않는다 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
@Documented
// Swagger에 인자로 드러나지 않게 숨긴다
@Parameter(hidden = true)
@AuthenticationPrincipal(expression = "T(java.lang.Long).parseLong(subject)")
public @interface CurrentUserId {}
