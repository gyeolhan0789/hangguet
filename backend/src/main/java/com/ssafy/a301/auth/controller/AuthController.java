package com.ssafy.a301.auth.controller;

import com.ssafy.a301.auth.dto.EmailAvailabilityResponse;
import com.ssafy.a301.auth.dto.LoginRequest;
import com.ssafy.a301.auth.dto.LogoutRequest;
import com.ssafy.a301.auth.dto.RefreshRequest;
import com.ssafy.a301.auth.dto.RefreshResponse;
import com.ssafy.a301.auth.dto.SignupRequest;
import com.ssafy.a301.auth.dto.SocialLoginRequest;
import com.ssafy.a301.auth.dto.SocialLoginResponse;
import com.ssafy.a301.auth.dto.SocialSignupRequest;
import com.ssafy.a301.auth.dto.TokenResponse;
import com.ssafy.a301.auth.service.AuthService;
import com.ssafy.a301.auth.service.SocialAuthService;
import com.ssafy.a301.common.web.CurrentUserId;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
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
    private final SocialAuthService social;

    public AuthController(AuthService service, SocialAuthService social) {
        this.service = service;
        this.social = social;
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
    @ApiResponse(responseCode = "200", description = "이메일·비밀번호 일치")
    @ApiResponse(
            responseCode = "401",
            description = "LOGIN_FAILED: 이메일 없음·비밀번호 틀림·탈퇴 회원·소셜 회원. 구분 없이 같은 문구")
    @ApiResponse(
            responseCode = "429",
            description =
                    "LOGIN_LOCKED: 같은 이메일로 5번 연속 틀려 15분 동안 잠김. 남은 시간은 Retry-After 헤더 ·"
                            + " retryAfterSeconds(초)")
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
    public void logout(@CurrentUserId long userId, @Valid @RequestBody LogoutRequest request) {
        service.logout(userId, request.refreshToken());
    }

    @Operation(summary = "1.6 소셜 로그인")
    @SecurityRequirements
    @ApiResponse(responseCode = "200", description = "가입한 회원이면 token, 처음 온 사람이면 signup(1.7로 가입)")
    @ApiResponse(
            responseCode = "400",
            description =
                    "SOCIAL_EMAIL_REQUIRED: 확인된 이메일을 주지 않음 · VALIDATION_FAILED: 지원하지 않는 provider,"
                            + " 등록하지 않은 redirectUri")
    @ApiResponse(responseCode = "401", description = "SOCIAL_LOGIN_FAILED: 쓸 수 없는 인가 코드")
    @ApiResponse(responseCode = "409", description = "SOCIAL_EMAIL_DUPLICATED: 같은 이메일로 가입한 회원이 있음")
    @ApiResponse(responseCode = "503", description = "SOCIAL_LOGIN_UNAVAILABLE: 제공자 서버 오류·시간 초과")
    @PostMapping("/oauth/{provider}")
    public SocialLoginResponse socialLogin(
            @Parameter(description = "제공자. kakao · google", example = "kakao") @PathVariable
                    String provider,
            @Valid @RequestBody SocialLoginRequest request) {
        return social.login(provider, request.code(), request.redirectUri());
    }

    @Operation(summary = "1.7 소셜 회원가입")
    @SecurityRequirements
    @ApiResponse(responseCode = "201", description = "가입 완료. 로그인 상태")
    @ApiResponse(responseCode = "400", description = "AGREEMENT_REQUIRED · VALIDATION_FAILED")
    @ApiResponse(
            responseCode = "401",
            description = "SIGNUP_TOKEN_INVALID: 가입 토큰이 없거나 만료됐거나 가입에 이미 씀")
    @ApiResponse(
            responseCode = "409",
            description = "SOCIAL_EMAIL_DUPLICATED: 그 사이 같은 이메일로 가입한 회원이 생김")
    @PostMapping("/oauth/signup")
    @ResponseStatus(HttpStatus.CREATED)
    public TokenResponse socialSignup(@Valid @RequestBody SocialSignupRequest request) {
        return social.signup(request);
    }
}
