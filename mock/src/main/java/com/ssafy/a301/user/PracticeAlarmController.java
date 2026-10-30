package com.ssafy.a301.user;

import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.UserDtos.PracticeAlarmEnableRequest;
import com.ssafy.a301.user.UserDtos.PracticeAlarmResponse;
import com.ssafy.a301.user.UserDtos.PracticeAlarmTimeRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
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

    private static final String ALARM_EXAMPLE =
            """
            { "available": true, "enabled": true, "time": "21:00" }\
            """;

    private final Stub stub;

    public PracticeAlarmController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "2.8 연습 알림 설정",
            description = "카카오로 가입한 회원만 켤 수 있다(available). 켜 두면 고른 시각에 그날 연습하지 않았을 때 카카오톡으로 알린다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = ALARM_EXAMPLE)))
    @GetMapping
    public PracticeAlarmResponse get() {
        return stub.read(ALARM_EXAMPLE, PracticeAlarmResponse.class);
    }

    @Operation(
            summary = "2.9 연습 알림 켜기",
            description =
                    "카카오 인가 요청에 scope=talk_message를 붙여 받은 인가 코드를 보낸다. 목 서버는 code로 결과를 고른다:"
                        + " `invalid` 400 KAKAO_CONSENT_FAILED · `mismatch` 400"
                        + " KAKAO_ACCOUNT_MISMATCH · `no-consent` 400"
                        + " KAKAO_MESSAGE_CONSENT_REQUIRED · `not-kakao` 409 · `unavailable` 503 ·"
                        + " 그 밖은 켜짐")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = ALARM_EXAMPLE)))
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "KAKAO_CONSENT_FAILED",
                                        value = ErrorExamples.KAKAO_CONSENT_FAILED),
                                @ExampleObject(
                                        name = "KAKAO_ACCOUNT_MISMATCH",
                                        value = ErrorExamples.KAKAO_ACCOUNT_MISMATCH),
                                @ExampleObject(
                                        name = "KAKAO_MESSAGE_CONSENT_REQUIRED",
                                        value = ErrorExamples.KAKAO_MESSAGE_CONSENT_REQUIRED)
                            }))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "PRACTICE_ALARM_UNAVAILABLE",
                                            value = ErrorExamples.PRACTICE_ALARM_UNAVAILABLE)))
    @ApiResponse(
            responseCode = "503",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "KAKAO_UNAVAILABLE",
                                            value = ErrorExamples.KAKAO_UNAVAILABLE)))
    @PutMapping
    public PracticeAlarmResponse enable(@Valid @RequestBody PracticeAlarmEnableRequest request) {
        switch (request.code()) {
            case "invalid" -> throw new ApiException(ErrorCode.KAKAO_CONSENT_FAILED);
            case "mismatch" -> throw new ApiException(ErrorCode.KAKAO_ACCOUNT_MISMATCH);
            case "no-consent" -> throw new ApiException(ErrorCode.KAKAO_MESSAGE_CONSENT_REQUIRED);
            case "not-kakao" -> throw new ApiException(ErrorCode.PRACTICE_ALARM_UNAVAILABLE);
            case "unavailable" -> throw new ApiException(ErrorCode.KAKAO_UNAVAILABLE);
            default -> {
                return stub.read(ALARM_EXAMPLE, PracticeAlarmResponse.class);
            }
        }
    }

    @Operation(summary = "2.10 연습 알림 시각 변경", description = "꺼져 있어도 저장해 두고 켤 때 쓴다. 다시 동의하지 않아도 된다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples =
                                    @ExampleObject(
                                            value =
                                                    "{ \"available\": true, \"enabled\": true,"
                                                            + " \"time\": \"22:30\" }")))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "PRACTICE_ALARM_UNAVAILABLE",
                                            value = ErrorExamples.PRACTICE_ALARM_UNAVAILABLE)))
    @PatchMapping
    public PracticeAlarmResponse changeTime(@Valid @RequestBody PracticeAlarmTimeRequest request) {
        return new PracticeAlarmResponse(true, true, request.time());
    }

    @Operation(summary = "2.11 연습 알림 끄기", description = "저장한 카카오 토큰을 지운다. 이미 꺼져 있어도 204")
    @ApiResponse(responseCode = "204")
    @DeleteMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void disable() {}
}
