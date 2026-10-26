package com.ssafy.a301.home.controller;

import com.ssafy.a301.home.dto.HomeDtos.HomeResponse;
import com.ssafy.a301.home.dto.HomeDtos.PracticeLogsResponse;
import com.ssafy.a301.home.dto.HomeDtos.StatsResponse;
import com.ssafy.a301.home.service.HomeService;
import com.ssafy.a301.home.service.PracticeStatsService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Pattern;
import java.time.YearMonth;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "3. 홈 · 스트릭")
@RestController
public class HomeController {
    private final HomeService home;
    private final PracticeStatsService stats;

    public HomeController(HomeService home, PracticeStatsService stats) {
        this.home = home;
        this.stats = stats;
    }

    @Operation(
            summary = "3.1 홈",
            description =
                    "홈 화면에 필요한 값을 한 번에 준다. 어떤 홈을 보여 줄지는 homeState로 구분한다."
                            + " 연습일·스트릭·오늘의 집계는 한국 시간 면접 시작 날짜 기준이다."
                            + " 기록이 없으면 FIRST_VISIT, 숫자 0, 배열은 빈 배열.")
    @GetMapping("/api/v1/home")
    public HomeResponse home(@AuthenticationPrincipal Jwt jwt) {
        return home.home(userId(jwt));
    }

    @Operation(
            summary = "3.2 통계",
            description =
                    "스트릭의 연습일은 한국 시간 면접 시작 날짜 기준이다. 면접 수·연습 시간은 답변 1개 이상으로 끝난 연습 면접만 센다."
                            + " 기록이 없으면 0·null.")
    @GetMapping("/api/v1/users/me/stats")
    public StatsResponse stats(@AuthenticationPrincipal Jwt jwt) {
        return stats.stats(userId(jwt));
    }

    @Operation(
            summary = "3.3 연습 달력",
            description =
                    "한 달 동안 연습한 날짜 목록. 연습일은 한국 시간 면접 시작 날짜 기준이며 스트릭·성장 리뷰와 같다."
                            + " 자정을 넘어 끝난 면접도 시작 날짜에만 포함한다. 없으면 빈 배열.")
    @ApiResponse(responseCode = "400", description = "VALIDATION_FAILED: month 누락 또는 YYYY-MM 형식 아님")
    @GetMapping("/api/v1/practice-logs")
    public PracticeLogsResponse practiceLogs(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "조회할 달(0001-01~9999-12)", example = "2026-10")
                    @RequestParam
                    @Pattern(
                            regexp = "(?!0000)[0-9]{4}-(0[1-9]|1[0-2])",
                            message = "YYYY-MM 형식입니다.")
                    String month) {
        return stats.practiceLogs(userId(jwt), YearMonth.parse(month));
    }

    private static long userId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
