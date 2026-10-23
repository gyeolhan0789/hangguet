package com.ssafy.a301.home;

import com.ssafy.a301.common.Stub;
import com.ssafy.a301.home.HomeDtos.HomeResponse;
import com.ssafy.a301.home.HomeDtos.PracticeLogsResponse;
import com.ssafy.a301.home.HomeDtos.StatsResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "3. 홈 · 스트릭")
@RestController
public class HomeController {

    static final String HOME_NOT_DONE =
            """
            { "homeState": "NOT_DONE_TODAY", "currentStreak": 7, "bestStreak": 7,
              "practiceDates": ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"],
              "todayInterviewCount": 0, "todayPracticeMinutes": 0, "todayImprovements": [],
              "nextActions": ["꼬리 질문엔 근거부터 짧게"], "nextActionsDate": "2026-10-14",
              "recentReviews": [
                { "practiceDate": "2026-10-14", "companyName": "○○전자", "criterion": "DELIVERY", "delta": 8 },
                { "practiceDate": "2026-10-13", "companyName": "△△소프트", "criterion": "LOGIC", "delta": 4 } ] }\
            """;
    private static final String HOME_DONE =
            """
            { "homeState": "DONE_TODAY", "currentStreak": 8, "bestStreak": 8,
              "practiceDates": ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"],
              "todayInterviewCount": 1, "todayPracticeMinutes": 18,
              "todayImprovements": [ { "criterion": "DELIVERY", "delta": 8 }, { "criterion": "LOGIC", "delta": 4 } ],
              "nextActions": ["꼬리 질문엔 근거부터 짧게", "직무 적합성 질문 1개 더 연습하기"], "nextActionsDate": "2026-10-15",
              "recentReviews": [
                { "practiceDate": "2026-10-15", "companyName": "○○전자", "criterion": "DELIVERY", "delta": 8 },
                { "practiceDate": "2026-10-14", "companyName": "○○전자", "criterion": "DELIVERY", "delta": 8 } ] }\
            """;
    private static final String HOME_BROKEN =
            """
            { "homeState": "BROKEN", "currentStreak": 0, "bestStreak": 7,
              "practiceDates": ["2026-10-10", "2026-10-11", "2026-10-12"],
              "todayInterviewCount": 0, "todayPracticeMinutes": 0, "todayImprovements": [],
              "nextActions": ["꼬리 질문엔 근거부터 짧게"], "nextActionsDate": "2026-10-12",
              "recentReviews": [
                { "practiceDate": "2026-10-12", "companyName": "○○전자", "criterion": "DELIVERY", "delta": 8 },
                { "practiceDate": "2026-10-11", "companyName": "△△소프트", "criterion": "LOGIC", "delta": 4 } ] }\
            """;
    private static final String HOME_FIRST =
            """
            { "homeState": "FIRST_VISIT", "currentStreak": 0, "bestStreak": 0,
              "practiceDates": [], "todayInterviewCount": 0, "todayPracticeMinutes": 0, "todayImprovements": [],
              "nextActions": [], "nextActionsDate": null, "recentReviews": [] }\
            """;
    private static final String STATS =
            """
            { "currentStreak": 7, "bestStreak": 12, "totalInterviewCount": 23, "totalPracticeMinutes": 400, "latestJobTitle": "백엔드 개발자" }\
            """;
    private static final String PRACTICE_LOGS =
            """
            { "content": [
                { "practiceDate": "2026-10-20", "createdAt": "2026-10-20T20:10:00+09:00" },
                { "practiceDate": "2026-10-21", "createdAt": "2026-10-21T19:42:00+09:00" } ] }\
            """;

    private final Stub stub;

    public HomeController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "3.1 홈",
            description =
                    "홈 화면에 필요한 값을 한 번에 준다. 어떤 홈을 보여 줄지는 `homeState`로 구분한다."
                            + " 연습일·스트릭·오늘의 집계는 한국 시간 면접 시작 날짜 기준이다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "S02 오늘 미완료", value = HOME_NOT_DONE),
                                @ExampleObject(name = "S02-B 오늘 완료", value = HOME_DONE),
                                @ExampleObject(name = "S02-C 스트릭 끊김", value = HOME_BROKEN),
                                @ExampleObject(name = "S02-D 첫 방문", value = HOME_FIRST)
                            }))
    @GetMapping("/api/v1/home")
    public HomeResponse home() {
        return stub.read(HOME_NOT_DONE, HomeResponse.class);
    }

    @Operation(summary = "3.2 통계", description = "스트릭의 연습일은 한국 시간 면접 시작 날짜 기준이다.")
    @ApiResponse(responseCode = "200", content = @Content(examples = @ExampleObject(value = STATS)))
    @GetMapping("/api/v1/users/me/stats")
    public StatsResponse stats() {
        return stub.read(STATS, StatsResponse.class);
    }

    @Operation(
            summary = "3.3 연습 달력",
            description =
                    "한 달 동안 연습한 날짜 목록. 연습일은 한국 시간 면접 시작 날짜 기준이며 스트릭·성장 리뷰와 같다."
                            + " 자정을 넘어 끝난 면접도 시작 날짜에만 포함한다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples =
                                    @ExampleObject(name = "한국 시간 시작일 기준", value = PRACTICE_LOGS)))
    @GetMapping("/api/v1/practice-logs")
    public PracticeLogsResponse practiceLogs(
            @Parameter(description = "조회할 달(YYYY-MM)", example = "2026-10")
                    @RequestParam
                    @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])", message = "YYYY-MM 형식입니다.")
                    String month) {
        if (!"2026-10".equals(month)) {
            return new PracticeLogsResponse(List.of());
        }
        return stub.read(PRACTICE_LOGS, PracticeLogsResponse.class);
    }
}
