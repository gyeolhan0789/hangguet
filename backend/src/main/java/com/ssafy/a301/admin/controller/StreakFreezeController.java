package com.ssafy.a301.admin.controller;

import com.ssafy.a301.admin.dto.AdminDtos.MyStreakFreezesResponse;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeUseRequest;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeUseResponse;
import com.ssafy.a301.admin.service.StreakFreezeService;
import com.ssafy.a301.common.web.CurrentUserId;
import io.swagger.v3.oas.annotations.Operation;
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
    private final StreakFreezeService service;

    public StreakFreezeController(StreakFreezeService service) {
        this.service = service;
    }

    @Operation(
            summary = "8.13 내 스트릭 유지권",
            description = "지금 쓸 수 있는 유지권(지급받았고 만료 전)의 개수와 유지권별 메울 수 있는 날짜 · 만료 일시를 준다.")
    @GetMapping
    public MyStreakFreezesResponse mine(@CurrentUserId long userId) {
        return service.mine(userId);
    }

    @Operation(
            summary = "8.14 유지권 사용",
            description =
                    "고른 유지권으로 그 유지권의 메울 수 있는 날짜를 연습한 날로 기록한다. 스트릭(2.1 · 3.1 · 3.2)과 연습 달력(3.3)에"
                            + " 들어간다. 이미 연습한 날이면 메울 수 없다.")
    @ApiResponse(responseCode = "200", description = "메움")
    @ApiResponse(responseCode = "404", description = "STREAK_FREEZE_NOT_FOUND: 없거나 남의 유지권")
    @ApiResponse(
            responseCode = "409",
            description =
                    "STREAK_FREEZE_NOT_AVAILABLE: 이미 썼거나 기간이 지남 / STREAK_FREEZE_DATE_NOT_ALLOWED:"
                            + " 이미 연습한 날")
    @PostMapping("/use")
    public StreakFreezeUseResponse use(
            @CurrentUserId long userId, @Valid @RequestBody StreakFreezeUseRequest request) {
        return service.use(userId, request.freezeId());
    }
}
