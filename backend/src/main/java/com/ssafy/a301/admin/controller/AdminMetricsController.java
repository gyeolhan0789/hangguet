package com.ssafy.a301.admin.controller;

import com.ssafy.a301.admin.dto.AdminDtos.AdminMetricsResponse;
import com.ssafy.a301.admin.service.AdminMetricsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/admin/metrics")
public class AdminMetricsController {
    private final AdminMetricsService service;

    public AdminMetricsController(AdminMetricsService service) {
        this.service = service;
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
