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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "3. 홈 · 스트릭")
@RestController
public class HomeController {

    private static final String RULES =
            """

            **스트릭 규칙**: 연습 면접 = 답변 1개 이상으로 끝난 면접(`ANALYZING`·`COMPLETED`·`FAILED`, `ABORTED` 제외). 연습한 날 = 연습 면접이 있는 날. 스트릭 = 오늘(또는 어제)까지 빠짐없이 이어진 연습일 수, 하루라도 빠지면 0. 뱃지 구간 0 / 1–2 / 3–6 / 7–13 / 14–20 / 21+일.\
            """;

    static final String HOME_NOT_DONE =
            """
            { "homeState": "NOT_DONE_TODAY", "currentStreak": 7, "bestStreak": 7, "leveledUpToday": true,
              "practiceDates": ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"],
              "todayInterviewCount": 0, "todayPracticeMinutes": 0, "todayImprovements": [],
              "nextActions": ["꼬리 질문엔 근거부터 짧게"], "nextActionsDate": "2026-10-14",
              "recentReviews": [
                { "practiceDate": "2026-10-14", "companyName": "○○전자", "criterion": "DELIVERY", "delta": 8 },
                { "practiceDate": "2026-10-13", "companyName": "△△소프트", "criterion": "LOGIC", "delta": 4 } ] }\
            """;
    private static final String HOME_DONE =
            """
            { "homeState": "DONE_TODAY", "currentStreak": 8, "bestStreak": 8, "leveledUpToday": false,
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
            { "homeState": "BROKEN", "currentStreak": 0, "bestStreak": 7, "leveledUpToday": false,
              "practiceDates": ["2026-10-10", "2026-10-11", "2026-10-12"],
              "todayInterviewCount": 0, "todayPracticeMinutes": 0, "todayImprovements": [],
              "nextActions": ["꼬리 질문엔 근거부터 짧게"], "nextActionsDate": "2026-10-12",
              "recentReviews": [
                { "practiceDate": "2026-10-12", "companyName": "○○전자", "criterion": "DELIVERY", "delta": 8 },
                { "practiceDate": "2026-10-11", "companyName": "△△소프트", "criterion": "LOGIC", "delta": 4 } ] }\
            """;
    private static final String HOME_FIRST =
            """
            { "homeState": "FIRST_VISIT", "currentStreak": 0, "bestStreak": 0, "leveledUpToday": false,
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
                { "practiceDate": "2026-10-01", "createdAt": "2026-10-01T21:12:00+09:00" },
                { "practiceDate": "2026-10-02", "createdAt": "2026-10-02T20:40:00+09:00" } ] }\
            """;

    private final Stub stub;

    public HomeController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "3.1 홈",
            description =
                    """
                    **화면 — S02 · S02-B · S02-C · S02-D, S02-1 인트로, S02-L 레벨업**

                    홈 한 장에 필요한 값을 한 번에 준다. 어떤 홈을 그릴지는 `homeState`로 정한다. 자정까지 남은 시간, 인트로·레벨업 하루 1회 노출은 화면이 처리한다.

                    - **200**: 항상. 기록이 없으면 `FIRST_VISIT`, 숫자 0, 배열 빈 배열\
                    """
                            + RULES)
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(
                                        name = "S02 오늘 미완료 + S02-L 레벨업",
                                        value = HOME_NOT_DONE),
                                @ExampleObject(name = "S02-B 오늘 완료", value = HOME_DONE),
                                @ExampleObject(name = "S02-C 스트릭 끊김", value = HOME_BROKEN),
                                @ExampleObject(name = "S02-D 첫 방문", value = HOME_FIRST)
                            }))
    @GetMapping("/api/v1/home")
    public HomeResponse home() {
        return stub.read(HOME_NOT_DONE, HomeResponse.class);
    }

    @Operation(
            summary = "3.2 통계",
            description =
                    """
                    **화면 — S09 마이페이지 › 통계 타일, 이름 아래 직무**

                    - **200**: 항상. 기록이 없으면 0·null\
                    """)
    @ApiResponse(responseCode = "200", content = @Content(examples = @ExampleObject(value = STATS)))
    @GetMapping("/api/v1/users/me/stats")
    public StatsResponse stats() {
        return stub.read(STATS, StatsResponse.class);
    }

    @Operation(
            summary = "3.3 연습 달력",
            description =
                    """
                    **화면 — S09 마이페이지 › 스트릭 달력** → 날짜 클릭 시 7.1

                    "이번 달 10일 연습"은 `content` 개수, "지금 7일 연속"은 3.2 `currentStreak`, 연속일 띠는 날짜가 이어지는지로 화면이 그린다.

                    - **200**: 항상. 없으면 빈 배열
                    - **400 / VALIDATION_FAILED**: `month` 형식 오류\
                    """)
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = PRACTICE_LOGS)))
    @GetMapping("/api/v1/practice-logs")
    public PracticeLogsResponse practiceLogs(
            @Parameter(description = "조회할 달(YYYY-MM)", example = "2026-10")
                    @RequestParam
                    @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])", message = "YYYY-MM 형식입니다.")
                    String month) {
        return stub.read(PRACTICE_LOGS, PracticeLogsResponse.class);
    }
}
