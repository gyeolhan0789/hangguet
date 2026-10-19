package com.ssafy.a301.growth.dto;

import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.Grade;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;

public final class GrowthDtos {

    private GrowthDtos() {}

    public record RecentReviewItem(
            @Schema(description = "연습한 날") LocalDate practiceDate,
            @Schema(description = "그날 마지막 면접의 회사명", example = "○○전자") String companyName,
            @Schema(description = "그날 가장 많이 오른 기준. 첫 연습일이면 null", nullable = true)
                    Criterion criterion,
            @Schema(
                            description = "그 기준의 변화량. \"전달력 +8\". 첫 연습일이면 null",
                            nullable = true,
                            example = "8")
                    Integer delta) {}

    public record CriterionReview(
            @Schema(description = "평가 기준") Criterion criterion,
            @Schema(description = "그날 결과가 나온 면접들의 평균 점수(0~100)", example = "70") int score,
            @Schema(description = "3단계. S08-C 기준점 표시") Grade grade,
            @Schema(
                            description =
                                    "직전 연습일 대비 변화. \"전달력 ↑8\". 첫 연습일이면 null. 자소서 검증은 화면에서 delta 없이"
                                            + " comment만 표시",
                            nullable = true,
                            example = "8")
                    Integer delta,
            @Schema(description = "그날 마지막 면접의 한 줄 설명", nullable = true) String comment) {}

    public record GrowthReviewResponse(
            @Schema(description = "그날") LocalDate practiceDate,
            @Schema(description = "첫 연습일이면 true → S08-C") boolean isFirst,
            @Schema(description = "비교한 직전 연습일. 첫 연습일이면 null", nullable = true)
                    LocalDate comparedDate,
            @Schema(
                            description = "그날 기준 스트릭. \"8일째 연습 완료!\". 설문 유도(3·7·21일째) 판단에도 쓴다",
                            example = "8")
                    int streakOnDate,
            @Schema(description = "그날 포함 최근 7일 중 연습한 날. 동그라미") List<LocalDate> practiceDates,
            @Schema(description = "그날 연습 면접 수", example = "1") int interviewCount,
            @Schema(description = "그날 연습 면접 시간 합(분)", example = "18") int practiceMinutes,
            @Schema(description = "기준 4개") List<CriterionReview> criteria,
            @Schema(description = "다음에 해볼 것. 최저 점수가 같으면 여러 개") List<String> nextActions) {}
}
