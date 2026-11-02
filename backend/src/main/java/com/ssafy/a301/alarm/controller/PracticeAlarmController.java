package com.ssafy.a301.alarm.controller;

import com.ssafy.a301.alarm.dto.PracticeAlarmDtos.PracticeAlarmEnableRequest;
import com.ssafy.a301.alarm.dto.PracticeAlarmDtos.PracticeAlarmResponse;
import com.ssafy.a301.alarm.dto.PracticeAlarmDtos.PracticeAlarmTimeRequest;
import com.ssafy.a301.alarm.service.PracticeAlarmService;
import com.ssafy.a301.common.web.CurrentUserId;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.LocalTime;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "2. 회원")
@RestController
@RequestMapping("/api/v1/users/me/practice-alarm")
public class PracticeAlarmController {
    private final PracticeAlarmService service;

    public PracticeAlarmController(PracticeAlarmService service) {
        this.service = service;
    }

    @Operation(
            summary = "2.8 연습 알림 설정",
            description =
                    "카카오 계정이 연결된 회원(카카오 가입 · 2.12 연결)만 켤 수 있다(available). 켜 두면 고른 시각에 그날 연습하지 않았을 때"
                            + " 카카오톡으로 알린다.")
    @GetMapping
    public PracticeAlarmResponse get(@CurrentUserId long userId) {
        return service.get(userId);
    }

    @Operation(
            summary = "2.9 연습 알림 켜기",
            description =
                    "카카오 인가 요청에 scope=talk_message를 붙여 받은 인가 코드를 보낸다. 연결된 카카오 계정과 같고 메시지 전송에 동의했을"
                            + " 때만 켠다.")
    @ApiResponse(responseCode = "200", description = "켜짐")
    @ApiResponse(
            responseCode = "400",
            description =
                    "KAKAO_CONSENT_FAILED: 쓸 수 없는 인가 코드 · KAKAO_ACCOUNT_MISMATCH: 다른 카카오 계정 ·"
                        + " KAKAO_MESSAGE_CONSENT_REQUIRED: 메시지 전송 동의 안 함 · VALIDATION_FAILED: 등록되지"
                        + " 않은 redirectUri")
    @ApiResponse(responseCode = "409", description = "PRACTICE_ALARM_UNAVAILABLE: 카카오 계정 연결 안 함")
    @ApiResponse(responseCode = "503", description = "KAKAO_UNAVAILABLE: 카카오 키 없음 · 카카오 서버 오류")
    @PutMapping
    public PracticeAlarmResponse enable(
            @CurrentUserId long userId, @Valid @RequestBody PracticeAlarmEnableRequest request) {
        return service.enable(userId, request.code(), request.redirectUri());
    }

    @Operation(summary = "2.10 연습 알림 시각 변경", description = "꺼져 있어도 저장해 두고 켤 때 쓴다. 다시 동의하지 않아도 된다.")
    @ApiResponse(responseCode = "200", description = "변경")
    @ApiResponse(responseCode = "409", description = "PRACTICE_ALARM_UNAVAILABLE: 카카오 계정 연결 안 함")
    @PatchMapping
    public PracticeAlarmResponse changeTime(
            @CurrentUserId long userId, @Valid @RequestBody PracticeAlarmTimeRequest request) {
        return service.changeTime(userId, LocalTime.parse(request.time()));
    }

    @Operation(summary = "2.11 연습 알림 끄기", description = "저장한 카카오 토큰을 지운다. 이미 꺼져 있어도 204")
    @ApiResponse(responseCode = "204", description = "꺼짐")
    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void disable(@CurrentUserId long userId) {
        service.disable(userId);
    }
}
