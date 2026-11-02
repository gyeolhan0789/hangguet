package com.ssafy.a301.user.controller;

import com.ssafy.a301.common.web.CurrentUserId;
import com.ssafy.a301.user.dto.UserDtos.MeResponse;
import com.ssafy.a301.user.dto.UserDtos.SocialLinkRequest;
import com.ssafy.a301.user.service.SocialAccountService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "2. 회원")
@RestController
@RequestMapping("/api/v1/users/me/social-accounts/{provider}")
public class SocialAccountController {
    private final SocialAccountService service;

    public SocialAccountController(SocialAccountService service) {
        this.service = service;
    }

    @Operation(
            summary = "2.12 소셜 계정 연결",
            description =
                    "이메일 회원이 카카오 로그인으로 받은 인가 코드를 보내 카카오 계정을 연결한다. 이메일이 달라도 연결하고, 이후 카카오 로그인(1.6)으로도"
                            + " 같은 회원에 들어간다. 응답은 2.1과 같다.")
    @ApiResponse(responseCode = "200", description = "연결")
    @ApiResponse(
            responseCode = "400",
            description =
                    "SOCIAL_LINK_FAILED: 쓸 수 없는 인가 코드 · VALIDATION_FAILED: kakao가 아닌 provider, 등록되지"
                            + " 않은 redirectUri")
    @ApiResponse(
            responseCode = "409",
            description =
                    "SOCIAL_ALREADY_LINKED: 소셜 회원이거나 이미 연결함 · SOCIAL_ACCOUNT_IN_USE: 다른 회원의 카카오 계정")
    @ApiResponse(
            responseCode = "503",
            description = "SOCIAL_LOGIN_UNAVAILABLE: 카카오 키 없음 · 카카오 서버 오류")
    @PutMapping
    public MeResponse link(
            @CurrentUserId long userId,
            @Parameter(description = "kakao만 지원", example = "kakao") @PathVariable String provider,
            @Valid @RequestBody SocialLinkRequest request) {
        return service.link(userId, provider, request.code(), request.redirectUri());
    }

    @Operation(
            summary = "2.13 소셜 계정 연결 해제",
            description = "카카오 로그인 연결을 끊고 켜져 있던 연습 알림을 끈다. 연결하지 않았어도 204")
    @ApiResponse(responseCode = "204", description = "해제")
    @ApiResponse(responseCode = "400", description = "VALIDATION_FAILED: kakao가 아닌 provider")
    @ApiResponse(responseCode = "409", description = "PASSWORD_NOT_SET: 소셜 회원(끊으면 로그인할 방법이 없음)")
    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unlink(
            @CurrentUserId long userId,
            @Parameter(description = "kakao만 지원", example = "kakao") @PathVariable
                    String provider) {
        service.unlink(userId, provider);
    }
}
