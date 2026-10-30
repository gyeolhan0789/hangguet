package com.ssafy.a301.admin;

import com.ssafy.a301.admin.AdminDtos.AdminMetricsResponse;
import com.ssafy.a301.admin.AdminDtos.DailyMetricsResponse;
import com.ssafy.a301.common.Stub;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
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

    private static final String METRICS =
            """
            { "date": "2026-10-23",
              "users": { "total": 120, "joinedToday": 3, "withdrawn": 7, "interviewed": 84 },
              "practice": { "practicedToday": 18, "practicedWeek": 61, "daily": [
                  { "date": "2026-10-17", "users": 22 }, { "date": "2026-10-18", "users": 19 },
                  { "date": "2026-10-19", "users": 15 }, { "date": "2026-10-20", "users": 27 },
                  { "date": "2026-10-21", "users": 24 }, { "date": "2026-10-22", "users": 21 },
                  { "date": "2026-10-23", "users": 18 } ],
                "retention": [
                  { "days": 1, "eligible": 124, "returned": 46 },
                  { "days": 3, "eligible": 118, "returned": 31 },
                  { "days": 7, "eligible": 103, "returned": 22 } ] },
              "interviews": { "total": 590, "completed": 580, "analyzing": 4, "failed": 6, "aborted": 50,
                              "video": 380, "chat": 210, "stuck": 1,
                              "personas": [ { "persona": "DEVIL", "count": 350 },
                                            { "persona": "COFFEE_CHAT", "count": 240 } ] },
              "averageScores": [
                { "criterion": "JOB_FIT", "score": 71.4 }, { "criterion": "COVER_LETTER", "score": 68.2 },
                { "criterion": "LOGIC", "score": 74.9 }, { "criterion": "DELIVERY", "score": 66.7 } ],
              "speech": { "sessions": 360, "fillerPerMin": 2.3, "longPauseCount": 2.8,
                          "speedDeviationPct": 6.4, "trailingOffRatio": 13.1, "pitchRangeSt": 5.9,
                          "gazeRatio": 70.8 },
              "applications": 150,
              "inquiries": { "waiting": 2 },
              "streakFreezes": { "granted": 260, "used": 41, "expired": 12 },
              "notices": [
                { "id": 3, "title": "10월 점검 안내", "readCount": 64 },
                { "id": 2, "title": "채팅 면접이 열렸어요", "readCount": 97 } ] }\
            """;

    // 10.19는 기록이 없는 날(0시에 서버가 꺼져 있었음)이라 빠진다
    private static final String DAILY =
            """
            { "from": "2026-10-16", "to": "2026-10-22", "content": [
                { "date": "2026-10-16", "usersTotal": 104, "usersJoined": 2, "usersWithdrawn": 5,
                  "usersInterviewed": 70, "practicedUsers": 21, "practicedWeek": 55,
                  "d1Eligible": 112, "d1Returned": 40, "d3Eligible": 105, "d3Returned": 28,
                  "d7Eligible": 92, "d7Returned": 19, "interviewsTotal": 520,
                  "interviewsCompleted": 510, "interviewsFailed": 6, "interviewsAborted": 50,
                  "interviewsStuck": 1, "applications": 150, "inquiriesWaiting": 3,
                  "freezesGranted": 260, "freezesUsed": 41, "recordedAt": "2026-10-17T00:00:00+09:00" },
                { "date": "2026-10-17", "usersTotal": 107, "usersJoined": 3, "usersWithdrawn": 5,
                  "usersInterviewed": 72, "practicedUsers": 22, "practicedWeek": 57,
                  "d1Eligible": 115, "d1Returned": 41, "d3Eligible": 108, "d3Returned": 29,
                  "d7Eligible": 95, "d7Returned": 20, "interviewsTotal": 534,
                  "interviewsCompleted": 524, "interviewsFailed": 6, "interviewsAborted": 50,
                  "interviewsStuck": 0, "applications": 150, "inquiriesWaiting": 2,
                  "freezesGranted": 260, "freezesUsed": 41, "recordedAt": "2026-10-18T00:00:00+09:00" },
                { "date": "2026-10-18", "usersTotal": 110, "usersJoined": 3, "usersWithdrawn": 6,
                  "usersInterviewed": 75, "practicedUsers": 19, "practicedWeek": 58,
                  "d1Eligible": 117, "d1Returned": 43, "d3Eligible": 110, "d3Returned": 30,
                  "d7Eligible": 97, "d7Returned": 21, "interviewsTotal": 548,
                  "interviewsCompleted": 538, "interviewsFailed": 6, "interviewsAborted": 50,
                  "interviewsStuck": 2, "applications": 150, "inquiriesWaiting": 4,
                  "freezesGranted": 260, "freezesUsed": 41, "recordedAt": "2026-10-19T00:00:00+09:00" },
                { "date": "2026-10-20", "usersTotal": 114, "usersJoined": 4, "usersWithdrawn": 6,
                  "usersInterviewed": 79, "practicedUsers": 27, "practicedWeek": 60,
                  "d1Eligible": 120, "d1Returned": 44, "d3Eligible": 112, "d3Returned": 30,
                  "d7Eligible": 99, "d7Returned": 21, "interviewsTotal": 566,
                  "interviewsCompleted": 556, "interviewsFailed": 6, "interviewsAborted": 50,
                  "interviewsStuck": 0, "applications": 150, "inquiriesWaiting": 1,
                  "freezesGranted": 260, "freezesUsed": 41, "recordedAt": "2026-10-21T00:00:00+09:00" },
                { "date": "2026-10-21", "usersTotal": 117, "usersJoined": 3, "usersWithdrawn": 7,
                  "usersInterviewed": 81, "practicedUsers": 24, "practicedWeek": 61,
                  "d1Eligible": 122, "d1Returned": 45, "d3Eligible": 115, "d3Returned": 31,
                  "d7Eligible": 101, "d7Returned": 22, "interviewsTotal": 578,
                  "interviewsCompleted": 568, "interviewsFailed": 6, "interviewsAborted": 50,
                  "interviewsStuck": 1, "applications": 150, "inquiriesWaiting": 3,
                  "freezesGranted": 260, "freezesUsed": 41, "recordedAt": "2026-10-22T00:00:00+09:00" },
                { "date": "2026-10-22", "usersTotal": 120, "usersJoined": 3, "usersWithdrawn": 7,
                  "usersInterviewed": 84, "practicedUsers": 21, "practicedWeek": 61,
                  "d1Eligible": 124, "d1Returned": 46, "d3Eligible": 118, "d3Returned": 31,
                  "d7Eligible": 103, "d7Returned": 22, "interviewsTotal": 590,
                  "interviewsCompleted": 580, "interviewsFailed": 6, "interviewsAborted": 50,
                  "interviewsStuck": 1, "applications": 150, "inquiriesWaiting": 2,
                  "freezesGranted": 260, "freezesUsed": 41, "recordedAt": "2026-10-23T00:00:00+09:00" } ] }\
            """;

    private final Stub stub;

    public AdminMetricsController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "8.15 관리자 메트릭",
            description =
                    "관리 페이지 홈의 집계. 날짜는 한국 시간 기준이며 연습 · 면접 집계는 면접 시작 날짜 기준이다."
                            + " 회원은 탈퇴하지 않은 회원만 센다. 새 테이블 없이 기존 테이블을 집계한다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = METRICS)))
    @GetMapping
    public AdminMetricsResponse metrics() {
        return stub.read(METRICS, AdminMetricsResponse.class);
    }

    @Operation(
            summary = "8.16 관리자 일별 메트릭",
            description =
                    "매일 0시(한국 시간)에 남긴 전날 8.15 집계를 어제까지 최근 days일만큼 준다. 기록이 없는 날은 빠진다."
                            + " 비율 대신 분자 · 분모를 준다.")
    @ApiResponse(responseCode = "200", content = @Content(examples = @ExampleObject(value = DAILY)))
    @ApiResponse(responseCode = "400", description = "VALIDATION_FAILED: days가 1~365 밖")
    @GetMapping("/daily")
    public DailyMetricsResponse daily(
            @Parameter(description = "어제까지 며칠(1~365)", example = "30")
                    @RequestParam(defaultValue = "30")
                    @Min(value = 1, message = "1~365입니다.")
                    @Max(value = 365, message = "1~365입니다.")
                    int days) {
        return stub.read(DAILY, DailyMetricsResponse.class);
    }
}
