package com.ssafy.a301.alarm.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public final class PracticeAlarmDtos {
    private static final String TIME_PATTERN = "^([01]\\d|2[0-3]):[0-5]\\d$";

    private PracticeAlarmDtos() {}

    @Schema(description = "카카오톡 연습 알림 설정")
    public record PracticeAlarmResponse(
            @Schema(
                            description =
                                    "카카오 계정이 연결된 회원(카카오 가입 · 2.12 연결)이면 true. false면 알림을 켤 수 없다",
                            example = "true")
                    boolean available,
            @Schema(description = "알림이 켜져 있으면 true", example = "true") boolean enabled,
            @Schema(description = "알림 시각(한국 시간, HH:mm). 고르지 않았으면 21:00", example = "21:00")
                    String time) {}

    public record PracticeAlarmEnableRequest(
            @Schema(description = "카카오가 콜백 주소로 넘겨 준 인가 코드(talk_message 동의 요청)", example = "Ab3x…")
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 2048, message = "최대 2048자입니다.")
                    String code,
            @Schema(
                            description = "인가 코드를 받은 콜백 주소. 카카오 로그인(1.6)과 같은 주소",
                            example = "https://hangguet.co.kr/oauth/kakao/callback")
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 2048, message = "최대 2048자입니다.")
                    String redirectUri) {}

    public record PracticeAlarmTimeRequest(
            @Schema(description = "알림 시각(한국 시간, HH:mm). 분 단위로 고를 수 있다", example = "22:30")
                    @NotBlank(message = "필수 값입니다.")
                    @Pattern(regexp = TIME_PATTERN, message = "HH:mm 형식(00:00~23:59)입니다.")
                    String time) {}
}
