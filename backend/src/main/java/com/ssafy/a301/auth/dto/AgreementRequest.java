package com.ssafy.a301.auth.dto;

import com.ssafy.a301.user.domain.TermsType;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record AgreementRequest(
        @Schema(description = "동의한 약관 종류", example = "TERMS") @NotNull(message = "필수 값입니다.")
                TermsType termsType,
        @Schema(description = "화면에 보여 준 약관 버전", example = "1.0", maxLength = 20)
                @NotBlank(message = "필수 값입니다.")
                @Size(max = 20, message = "최대 20자입니다.")
                String termsVersion) {}
