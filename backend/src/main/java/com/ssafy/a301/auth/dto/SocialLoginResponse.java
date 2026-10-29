package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "가입한 회원이면 token, 처음 온 사람이면 signup만 있다")
public record SocialLoginResponse(
        @Schema(description = "처음 온 사람이라 약관 동의(1.7)가 필요하면 true") boolean signupRequired,
        @Schema(description = "로그인 토큰(1.3 응답과 같음). signupRequired면 null", nullable = true)
                TokenResponse token,
        @Schema(description = "가입에 쓸 정보. 가입한 회원이면 null", nullable = true) SocialSignup signup) {

    public static SocialLoginResponse loggedIn(TokenResponse token) {
        return new SocialLoginResponse(false, token, null);
    }

    public static SocialLoginResponse signupRequired(SocialSignup signup) {
        return new SocialLoginResponse(true, null, signup);
    }

    public record SocialSignup(
            @Schema(description = "1.7에 보낼 가입 토큰. 가입에 성공하면 다시 쓸 수 없다", example = "Zm9v…")
                    String signupToken,
            @Schema(description = "가입할 이메일(제공자가 확인한 이메일)", example = "a@kakao.com") String email,
            @Schema(description = "가입할 닉네임(제공자 닉네임). 가입 뒤 2.2로 바꿀 수 있다", example = "면접왕")
                    String nickname,
            @Schema(description = "가입 토큰 유효 시간(초)", example = "600") long expiresIn) {}
}
