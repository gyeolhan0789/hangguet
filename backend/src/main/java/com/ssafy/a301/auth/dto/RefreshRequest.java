package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

public record RefreshRequest(
        @Schema(description = "마지막으로 받은 리프레시 토큰", example = "eyJ…") @NotBlank(message = "필수 값입니다.")
                String refreshToken) {}
