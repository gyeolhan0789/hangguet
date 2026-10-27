package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record LoginRequest(
        @Schema(example = "a@ssafy.com", maxLength = 255)
                @NotBlank(message = "필수 값입니다.")
                @Size(max = 255, message = "최대 255자입니다.")
                String email,
        @Schema(example = "abcd1234", maxLength = 64)
                @NotBlank(message = "필수 값입니다.")
                @Size(max = 64, message = "최대 64자입니다.")
                String password) {}
