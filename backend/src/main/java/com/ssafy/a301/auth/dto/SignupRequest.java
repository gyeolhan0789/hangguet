package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

public record SignupRequest(
        @Schema(description = "로그인 아이디. 가입 후 변경 불가", example = "a@ssafy.com", maxLength = 255)
                @NotBlank(message = "필수 값입니다.")
                @Email(message = "이메일 형식이 아닙니다.")
                @Size(max = 255, message = "최대 255자입니다.")
                String email,
        @Schema(
                        description = "8~64자, 영문·숫자 각 1자 이상. 응답에 되돌려 주지 않는다",
                        example = "abcd1234",
                        minLength = 8,
                        maxLength = 64)
                @NotBlank(message = "필수 값입니다.")
                @Size(min = 8, max = 64, message = "8~64자, 영문과 숫자를 모두 포함해야 합니다.")
                @Pattern(
                        regexp = "^(?=.*[A-Za-z])(?=.*\\d).+$",
                        message = "8~64자, 영문과 숫자를 모두 포함해야 합니다.")
                String password,
        @Schema(
                        description = "화면에 보이는 이름. 앞뒤 공백 제거",
                        example = "면접왕",
                        minLength = 1,
                        maxLength = 50)
                @NotBlank(message = "필수 값입니다.")
                @Size(max = 50, message = "1~50자입니다.")
                String nickname,
        @Schema(description = "필수 약관 3개(TERMS·PRIVACY·RECORDING) 모두. termsType 중복 불가")
                @NotNull(message = "필수 값입니다.")
                @Size(min = 3, max = 3, message = "약관 3개가 필요합니다.")
                List<@NotNull @Valid AgreementRequest> agreements) {}
