package com.ssafy.a301.admin;

import com.ssafy.a301.admin.AdminDtos.AdminMetricsResponse;
import com.ssafy.a301.common.Stub;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/admin/metrics")
public class AdminMetricsController {

    private static final String METRICS =
            """
            { "date": "2026-10-23",
              "users": { "total": 120, "joinedToday": 3 },
              "practice": { "practicedToday": 18, "daily": [
                  { "date": "2026-10-17", "users": 22 }, { "date": "2026-10-18", "users": 19 },
                  { "date": "2026-10-19", "users": 15 }, { "date": "2026-10-20", "users": 27 },
                  { "date": "2026-10-21", "users": 24 }, { "date": "2026-10-22", "users": 21 },
                  { "date": "2026-10-23", "users": 18 } ] },
              "interviews": { "total": 590, "completed": 580, "analyzing": 4, "failed": 6, "aborted": 50,
                              "video": 380, "chat": 210 },
              "averageScores": [
                { "criterion": "JOB_FIT", "score": 71.4 }, { "criterion": "COVER_LETTER", "score": 68.2 },
                { "criterion": "LOGIC", "score": 74.9 }, { "criterion": "DELIVERY", "score": 66.7 } ],
              "streakFreezes": { "granted": 260, "used": 41, "expired": 12 },
              "notices": [
                { "id": 3, "title": "10월 점검 안내", "readCount": 64 },
                { "id": 2, "title": "채팅 면접이 열렸어요", "readCount": 97 } ] }\
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
}
