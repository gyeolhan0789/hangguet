package com.ssafy.a301.admin.controller;

import com.ssafy.a301.admin.dto.AdminDtos.AdminLoginRequest;
import com.ssafy.a301.admin.dto.AdminDtos.AdminTokenResponse;
import com.ssafy.a301.admin.service.AdminAuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/admin/auth")
public class AdminAuthController {
    private final AdminAuthService service;

    public AdminAuthController(AdminAuthService service) {
        this.service = service;
    }

    @Operation(
            summary = "8.1 관리자 로그인",
            description = "관리 페이지 로그인. 관리 API(`/api/v1/admin/**`)는 이 토큰으로 부른다. 재발급은 없다.")
    @SecurityRequirements
    @ApiResponse(responseCode = "200", description = "로그인")
    @ApiResponse(responseCode = "401", description = "ADMIN_LOGIN_FAILED: 아이디 또는 비밀번호 틀림")
    @PostMapping("/login")
    public AdminTokenResponse login(@Valid @RequestBody AdminLoginRequest request) {
        return service.login(request.loginId(), request.password());
    }

    @Operation(summary = "8.2 관리자 로그아웃", description = "이 토큰은 만료 전이라도 더 쓸 수 없다.")
    @ApiResponse(responseCode = "204", description = "로그아웃")
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@AuthenticationPrincipal Jwt jwt) {
        service.logout(jwt.getTokenValue(), jwt.getExpiresAt());
    }
}
