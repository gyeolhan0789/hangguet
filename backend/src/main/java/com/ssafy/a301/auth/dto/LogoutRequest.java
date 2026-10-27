package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;

public record LogoutRequest(
        @Schema(description = "폐기할 리프레시 토큰", example = "eyJ…") @NotBlank(message = "필수 값입니다.")
                String refreshToken) {}
