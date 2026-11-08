package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record PasswordResetRequest(
        @Schema(description = "가입한 이메일", example = "a@ssafy.com", maxLength = 255)
                @NotBlank(message = "필수 값입니다.")
                @Email(message = "이메일 형식이 아닙니다.")
                @Size(max = 255, message = "최대 255자입니다.")
                String email) {}
