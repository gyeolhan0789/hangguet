package com.ssafy.a301.growth;

import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.growth.GrowthDtos.GrowthReviewResponse;
import com.ssafy.a301.growth.GrowthDtos.RecentReviewItem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.LocalDate;
import java.util.List;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.web.PagedModel;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.type.TypeReference;

@Tag(name = "7. 성장 리뷰")
@RestController
@RequestMapping("/api/v1/growth-reviews")
public class GrowthReviewController {

    private static final String REVIEW =
            """
            { "practiceDate": "2026-10-13", "isFirst": false, "comparedDate": "2026-10-12", "streakOnDate": 8,
              "practiceDates": ["2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"],
              "interviewCount": 1, "practiceMinutes": 18,
              "criteria": [
                { "criterion": "DELIVERY", "score": 70, "grade": "NORMAL", "delta": 8, "comment": "말 끊김이 줄었어요" },
                { "criterion": "LOGIC", "score": 80, "grade": "GOOD", "delta": 4, "comment": "결론부터 말했어요" },
                { "criterion": "COVER_LETTER", "score": 76, "grade": "GOOD", "delta": 0, "comment": "막힘 없이 통과" },
                { "criterion": "JOB_FIT", "score": 62, "grade": "NORMAL", "delta": -3, "comment": "직무 적합성 질문 1개 더 연습하기" } ],
              "nextActions": ["직무 적합성 질문 1개 더 연습하기"] }\
            """;
    private static final String REVIEW_FIRST =
            """
            { "practiceDate": "2026-10-15", "isFirst": true, "comparedDate": null, "streakOnDate": 1,
              "practiceDates": ["2026-10-15"], "interviewCount": 1, "practiceMinutes": 18,
              "criteria": [
                { "criterion": "JOB_FIT", "score": 82, "grade": "GOOD", "delta": null, "comment": "직무 경험을 수치로 설명했어요" },
                { "criterion": "COVER_LETTER", "score": 58, "grade": "WEAK", "delta": null, "comment": "꼬리 질문엔 근거부터 짧게" },
                { "criterion": "LOGIC", "score": 80, "grade": "GOOD", "delta": null, "comment": "결론부터 말했어요" },
                { "criterion": "DELIVERY", "score": 70, "grade": "NORMAL", "delta": null, "comment": "말 끊김이 줄었어요" } ],
              "nextActions": ["꼬리 질문엔 근거부터 짧게"] }\
            """;
    private static final String RECENT_ITEMS =
            """
            [ { "practiceDate": "2026-10-12", "companyName": "○○전자", "criterion": "DELIVERY", "delta": 8 },
              { "practiceDate": "2026-10-11", "companyName": "△△소프트", "criterion": "LOGIC", "delta": 4 } ]\
            """;
    private static final String RECENT =
            """
            { "content": [
                { "practiceDate": "2026-10-12", "companyName": "○○전자", "criterion": "DELIVERY", "delta": 8 },
                { "practiceDate": "2026-10-11", "companyName": "△△소프트", "criterion": "LOGIC", "delta": 4 } ],
              "page": { "size": 2, "number": 0, "totalElements": 7, "totalPages": 4 } }\
            """;

    private final Stub stub;

    public GrowthReviewController(Stub stub) {
        this.stub = stub;
    }

    @Operation(summary = "7.1 날짜별 성장 리뷰")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "S08 오늘의 성장 리뷰", value = REVIEW),
                                @ExampleObject(name = "S08-C 첫 면접", value = REVIEW_FIRST)
                            }))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "GROWTH_REVIEW_NOT_FOUND",
                                            value = ErrorExamples.GROWTH_REVIEW_NOT_FOUND)))
    @GetMapping("/{practiceDate}")
    public GrowthReviewResponse byDate(
            @Parameter(description = "연습한 날짜(YYYY-MM-DD, 한국 시간)", example = "2026-10-13")
                    @PathVariable
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate practiceDate) {
        return stub.read(REVIEW, GrowthReviewResponse.class);
    }

    @Operation(summary = "7.2 최근 성장 리뷰", description = "최근 날짜 순 페이지 목록.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = RECENT)))
    @GetMapping
    public PagedModel<RecentReviewItem> recent(
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "2")
                    @RequestParam(defaultValue = "2")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        List<RecentReviewItem> items = stub.read(RECENT_ITEMS, new TypeReference<>() {});
        return new PagedModel<>(new PageImpl<>(items, PageRequest.of(page, size), 7));
    }
}
