package com.ssafy.a301.auth.controller;

import com.ssafy.a301.auth.dto.EmailAvailabilityResponse;
import com.ssafy.a301.auth.dto.LoginRequest;
import com.ssafy.a301.auth.dto.LogoutRequest;
import com.ssafy.a301.auth.dto.RefreshRequest;
import com.ssafy.a301.auth.dto.RefreshResponse;
import com.ssafy.a301.auth.dto.SignupRequest;
import com.ssafy.a301.auth.dto.TokenResponse;
import com.ssafy.a301.auth.service.AuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "1. 인증")
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthService service;

    public AuthController(AuthService service) {
        this.service = service;
    }

    @Operation(summary = "1.1 이메일 사용 가능 여부")
    @SecurityRequirements
    @GetMapping("/email-availability")
    public EmailAvailabilityResponse emailAvailability(
            @RequestParam @NotBlank @Email @Size(max = 255) String email) {
        return new EmailAvailabilityResponse(service.isEmailAvailable(email));
    }

    @Operation(summary = "1.2 회원가입")
    @SecurityRequirements
    @PostMapping("/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public TokenResponse signup(@Valid @RequestBody SignupRequest request) {
        return service.signup(request);
    }

    @Operation(summary = "1.3 로그인")
    @SecurityRequirements
    @PostMapping("/login")
    public TokenResponse login(@Valid @RequestBody LoginRequest request) {
        return service.login(request);
    }

    @Operation(summary = "1.4 토큰 재발급")
    @SecurityRequirements
    @PostMapping("/token/refresh")
    public RefreshResponse refresh(@Valid @RequestBody RefreshRequest request) {
        return service.refresh(request.refreshToken());
    }

    @Operation(summary = "1.5 로그아웃")
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(
            @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody LogoutRequest request) {
        service.logout(Long.parseLong(jwt.getSubject()), request.refreshToken());
    }
}
