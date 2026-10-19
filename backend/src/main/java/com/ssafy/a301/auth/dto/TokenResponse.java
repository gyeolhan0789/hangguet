package com.ssafy.a301.auth.dto;

import com.ssafy.a301.user.dto.UserDtos.UserSummary;
import io.swagger.v3.oas.annotations.media.Schema;

public record TokenResponse(
        @Schema(description = "API 호출용 토큰. `Authorization: Bearer {accessToken}`", example = "eyJ…")
                String accessToken,
        @Schema(description = "액세스 토큰 재발급용 토큰(1.4)", example = "eyJ…") String refreshToken,
        @Schema(description = "액세스 토큰 유효 시간(초)", example = "3600") long expiresIn,
        @Schema(description = "로그인한 회원") UserSummary user) {}
