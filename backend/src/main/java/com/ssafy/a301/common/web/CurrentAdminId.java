package com.ssafy.a301.common.web;

import io.swagger.v3.oas.annotations.Parameter;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.security.core.annotation.AuthenticationPrincipal;

/** 로그인한 관리자 id(관리자 액세스 토큰의 sub, 8.1). 관리 API 컨트롤러 인자에 붙인다 */
@Target(ElementType.PARAMETER)
@Retention(RetentionPolicy.RUNTIME)
@Documented
// Swagger에 인자로 드러나지 않게 숨긴다
@Parameter(hidden = true)
@AuthenticationPrincipal(expression = "T(java.lang.Long).parseLong(subject)")
public @interface CurrentAdminId {}
