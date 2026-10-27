package com.ssafy.a301.auth;

import com.ssafy.a301.user.UserDtos.UserSummary;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

public final class AuthDtos {

    private AuthDtos() {}

    @Schema(description = "약관 종류. TERMS 이용약관 · PRIVACY 개인정보 수집·이용 · RECORDING 면접 녹화·음성 이용")
    public enum TermsType {
        TERMS,
        PRIVACY,
        RECORDING
    }

    public record EmailAvailabilityResponse(
            @Schema(description = "가입에 쓸 수 있으면 true. 사용 중이면 false(오류 아님)", example = "true")
                    boolean available) {}

    public record AgreementRequest(
            @Schema(description = "동의한 약관 종류", example = "TERMS") @NotNull(message = "필수 값입니다.")
                    TermsType termsType,
            @Schema(description = "화면에 보여 준 약관 버전", example = "1.0", maxLength = 20)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 20, message = "최대 20자입니다.")
                    String termsVersion) {}

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

    public record LoginRequest(
            @Schema(example = "a@ssafy.com", maxLength = 255)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 255, message = "최대 255자입니다.")
                    String email,
            @Schema(example = "abcd1234", maxLength = 64)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 64, message = "최대 64자입니다.")
                    String password) {}

    public record TokenResponse(
            @Schema(
                            description =
                                    "API 호출용 JWT(HS256). `sub`(회원 id)·`nickname`·`iat`·`exp`를 담는다."
                                            + " `Authorization: Bearer {accessToken}`",
                            example = "eyJ…")
                    String accessToken,
            @Schema(
                            description = "액세스 토큰 재발급용 토큰(1.4)",
                            example = "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10")
                    String refreshToken,
            @Schema(description = "액세스 토큰 유효 시간(초)", example = "3600") long expiresIn,
            @Schema(description = "로그인한 회원") UserSummary user) {}

    public record RefreshRequest(
            @Schema(
                            description = "마지막으로 받은 리프레시 토큰",
                            example = "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10")
                    @NotBlank(message = "필수 값입니다.")
                    String refreshToken) {}

    public record RefreshResponse(
            @Schema(description = "새 액세스 토큰. 1.3 응답의 accessToken과 같은 형식", example = "eyJ…")
                    String accessToken,
            @Schema(
                            description = "새 리프레시 토큰. 요청에 쓴 토큰은 다시 쓸 수 없다",
                            example = "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10")
                    String refreshToken,
            @Schema(description = "액세스 토큰 유효 시간(초)", example = "3600") long expiresIn) {}

    public record LogoutRequest(
            @Schema(description = "폐기할 리프레시 토큰", example = "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10")
                    @NotBlank(message = "필수 값입니다.")
                    String refreshToken) {}
}
