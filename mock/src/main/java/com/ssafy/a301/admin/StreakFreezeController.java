package com.ssafy.a301.admin;

import com.ssafy.a301.admin.AdminDtos.MyStreakFreezesResponse;
import com.ssafy.a301.admin.AdminDtos.StreakFreezeUseRequest;
import com.ssafy.a301.admin.AdminDtos.StreakFreezeUseResponse;
import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/users/me/streak-freezes")
public class StreakFreezeController {

    private static final String MINE =
            """
            { "availableCount": 2,
              "freezes": [
                { "id": 31, "fillableDate": "2026-10-19", "grantedAt": "2026-10-20T00:00:00+09:00", "expiresAt": "2026-11-03T00:00:00+09:00" },
                { "id": 32, "fillableDate": "2026-10-19", "grantedAt": "2026-10-20T00:00:00+09:00", "expiresAt": "2026-11-03T00:00:00+09:00" } ] }\
            """;
    private static final String MINE_EMPTY = "{ \"availableCount\": 0, \"freezes\": [] }";
    private static final String USE_REQUEST = "{ \"freezeId\": 31 }";
    private static final String USED =
            """
            { "practiceDate": "2026-10-19", "freezeId": 31, "availableCount": 1, "currentStreak": 9 }\
            """;

    private final Stub stub;

    public StreakFreezeController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "8.13 내 스트릭 유지권",
            description = "지금 쓸 수 있는 유지권(지급 날짜가 지났고 만료 전)의 개수와 유지권별 메울 수 있는 날짜 · 만료 일시를 준다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "2개 있음", value = MINE),
                                @ExampleObject(name = "없음", value = MINE_EMPTY)
                            }))
    @GetMapping
    public MyStreakFreezesResponse mine() {
        return stub.read(MINE, MyStreakFreezesResponse.class);
    }

    @Operation(
            summary = "8.14 유지권 사용",
            description =
                    "고른 유지권으로 그 유지권의 메울 수 있는 날짜를 연습한 날로 기록한다. 스트릭(2.1 · 3.1 · 3.2)과 연습 달력(3.3)에"
                            + " 들어간다. 이미 연습한 날이면 메울 수 없다.")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(
            content = @Content(examples = @ExampleObject(value = USE_REQUEST)))
    @ApiResponse(responseCode = "200", content = @Content(examples = @ExampleObject(value = USED)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "STREAK_FREEZE_NOT_FOUND",
                                            value = ErrorExamples.STREAK_FREEZE_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "STREAK_FREEZE_NOT_AVAILABLE",
                                        value = ErrorExamples.STREAK_FREEZE_NOT_AVAILABLE),
                                @ExampleObject(
                                        name = "STREAK_FREEZE_DATE_NOT_ALLOWED",
                                        value = ErrorExamples.STREAK_FREEZE_DATE_NOT_ALLOWED)
                            }))
    @PostMapping("/use")
    public StreakFreezeUseResponse use(@Valid @RequestBody StreakFreezeUseRequest request) {
        Stub.notFoundIfZero(request.freezeId(), ErrorCode.STREAK_FREEZE_NOT_FOUND);
        StreakFreezeUseResponse used = stub.read(USED, StreakFreezeUseResponse.class);
        return new StreakFreezeUseResponse(
                used.practiceDate(),
                request.freezeId(),
                used.availableCount(),
                used.currentStreak());
    }
}
