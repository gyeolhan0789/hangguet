package com.ssafy.a301.growth.controller;

import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.growth.dto.GrowthDtos.GrowthReviewResponse;
import com.ssafy.a301.growth.dto.GrowthDtos.RecentReviewItem;
import com.ssafy.a301.growth.service.GrowthReviewService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.LocalDate;
import org.springframework.data.web.PagedModel;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "7. 성장 리뷰")
@RestController
@RequestMapping("/api/v1/growth-reviews")
public class GrowthReviewController {
    // 5.15 월 범위(0001-01~9999-12)와 같은 네 자리 연도만 받는다. ISO 날짜는 0000년·다섯 자리 연도도 읽어서, 막지 않으면 시각 계산·DB에서
    // 500이 된다.
    private static final LocalDate MIN_DATE = LocalDate.of(1, 1, 1);
    private static final LocalDate MAX_DATE = LocalDate.of(9999, 12, 31);

    private final GrowthReviewService reviews;

    public GrowthReviewController(GrowthReviewService reviews) {
        this.reviews = reviews;
    }

    @Operation(
            summary = "7.1 날짜별 성장 리뷰",
            description =
                    "연습일·스트릭·일별 점수와 시간은 한국 시간 면접 시작 날짜 기준이다. 자정을 넘어 끝나도 시작일에 집계한다."
                            + " 점수는 그날 시작한 결과 완료 면접들의 기준별 평균이다.")
    @ApiResponse(
            responseCode = "400",
            description = "VALIDATION_FAILED: YYYY-MM-DD 형식이 아니거나 0001-01-01~9999-12-31 밖")
    @ApiResponse(
            responseCode = "404",
            description = "GROWTH_REVIEW_NOT_FOUND: 그날 연습 기록이 없거나 결과가 나온 면접이 없음")
    @GetMapping("/{practiceDate}")
    public GrowthReviewResponse byDate(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "면접 시작 날짜(YYYY-MM-DD, 한국 시간)", example = "2026-10-13")
                    @PathVariable
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate practiceDate) {
        if (practiceDate.isBefore(MIN_DATE) || practiceDate.isAfter(MAX_DATE)) {
            throw new FieldValidationException("practiceDate", "0001-01-01~9999-12-31입니다.");
        }
        return reviews.review(userId(jwt), practiceDate);
    }

    @Operation(summary = "7.2 최근 성장 리뷰", description = "한국 시간 면접 시작 날짜로 묶은 성장 리뷰 목록을 최근 날짜 순으로 준다.")
    @GetMapping
    public PagedModel<RecentReviewItem> recent(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "2")
                    @RequestParam(defaultValue = "2")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        return reviews.recent(userId(jwt), page, size);
    }

    private static long userId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
