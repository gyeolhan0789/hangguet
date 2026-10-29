package com.ssafy.a301.auth.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SocialLoginRequest(
        @Schema(description = "제공자가 redirectUri로 넘겨 준 인가 코드. 한 번만 쓸 수 있다", example = "abc123…")
                @NotBlank(message = "필수 값입니다.")
                @Size(max = 2048, message = "최대 2048자입니다.")
                String code,
        @Schema(
                        description = "인가 코드를 받을 때 쓴 주소. 서버에 등록한 주소만 받는다",
                        example = "https://a301.example.com/oauth/kakao/callback")
                @NotBlank(message = "필수 값입니다.")
                @Size(max = 2048, message = "최대 2048자입니다.")
                String redirectUri) {}
