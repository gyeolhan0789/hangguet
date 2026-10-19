package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

public record RefreshResponse(
        @Schema(description = "새 액세스 토큰", example = "eyJ…") String accessToken,
        @Schema(description = "새 리프레시 토큰. 요청에 쓴 토큰은 다시 쓸 수 없다", example = "eyJ…")
                String refreshToken,
        @Schema(description = "액세스 토큰 유효 시간(초)", example = "3600") long expiresIn) {}
