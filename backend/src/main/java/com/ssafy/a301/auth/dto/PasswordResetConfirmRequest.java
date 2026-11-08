package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record PasswordResetConfirmRequest(
        @Schema(description = "메일 링크의 token", example = "Zm9v…")
                @NotBlank(message = "필수 값입니다.")
                @Size(max = 100, message = "최대 100자입니다.")
                String token,
        @Schema(
                        description = "새 비밀번호. 8~64자, 영문·숫자 각 1자 이상(2.3과 같음)",
                        example = "efgh5678",
                        minLength = 8,
                        maxLength = 64)
                @NotBlank(message = "필수 값입니다.")
                @Size(min = 8, max = 64, message = "8~64자, 영문과 숫자를 모두 포함해야 합니다.")
                @Pattern(
                        regexp = "^(?=.*[A-Za-z])(?=.*\\d).+$",
                        message = "8~64자, 영문과 숫자를 모두 포함해야 합니다.")
                String newPassword) {}
