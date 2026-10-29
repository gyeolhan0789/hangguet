package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

public record SocialSignupRequest(
        @Schema(description = "1.6에서 받은 가입 토큰", example = "Zm9v…")
                @NotBlank(message = "필수 값입니다.")
                @Size(max = 100, message = "최대 100자입니다.")
                String signupToken,
        @Schema(description = "필수 약관 3개(TERMS·PRIVACY·RECORDING) 모두. termsType 중복 불가(1.2와 같음)")
                @NotNull(message = "필수 값입니다.")
                @Size(min = 3, max = 3, message = "약관 3개가 필요합니다.")
                List<@NotNull @Valid AgreementRequest> agreements) {}
