package com.ssafy.a301.admin.controller;

import com.ssafy.a301.admin.dto.AdminDtos.AdminMetricsResponse;
import com.ssafy.a301.admin.dto.AdminDtos.DailyMetricsResponse;
import com.ssafy.a301.admin.service.AdminDailyMetricService;
import com.ssafy.a301.admin.service.AdminMetricsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/admin/metrics")
public class AdminMetricsController {
    private final AdminMetricsService service;

    private final AdminDailyMetricService daily;

    public AdminMetricsController(AdminMetricsService service, AdminDailyMetricService daily) {
        this.service = service;
        this.daily = daily;
    }

    @Operation(
            summary = "8.16 관리자 일별 메트릭",
            description =
                    "매일 0시(한국 시간)에 남긴 전날 8.15 집계를 어제까지 최근 days일만큼 준다. 기록이 없는 날은 빠진다."
                            + " 비율 대신 분자 · 분모를 준다.")
    @ApiResponse(responseCode = "400", description = "VALIDATION_FAILED: days가 1~365 밖")
    @GetMapping("/daily")
    public DailyMetricsResponse daily(
            @Parameter(description = "어제까지 며칠(1~365)", example = "30")
                    @RequestParam(defaultValue = "30")
                    @Min(value = 1, message = "1~365입니다.")
                    @Max(value = 365, message = "1~365입니다.")
                    int days) {
        return daily.recent(days);
    }

    @Operation(
            summary = "8.15 관리자 메트릭",
            description =
                    "관리 페이지 홈의 집계. 날짜는 한국 시간 기준이며 연습 · 면접 집계는 면접 시작 날짜 기준이다."
                            + " 회원은 탈퇴하지 않은 회원만 센다. 새 테이블 없이 기존 테이블을 집계한다.")
    @GetMapping
    public AdminMetricsResponse metrics() {
        return service.metrics();
    }
}
