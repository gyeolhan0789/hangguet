package com.ssafy.a301.growth;

import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.List;

public final class GrowthDtos {

    private GrowthDtos() {}

    @Schema(
            description =
                    "평가 기준. 화면 이름: JOB_FIT 직무 적합성 · COVER_LETTER 자소서 검증 · LOGIC 논리성 · DELIVERY 전달력")
    public enum Criterion {
        JOB_FIT,
        COVER_LETTER,
        LOGIC,
        DELIVERY
    }

    @Schema(description = "3단계. GOOD 좋아요 · NORMAL 보통 · WEAK 아쉬워요. 점수 경계는 API 명세 6.3")
    public enum Grade {
        GOOD,
        NORMAL,
        WEAK
    }

    public record RecentReviewItem(
            @Schema(description = "한국 시간 면접 시작 날짜 기준 연습일") LocalDate practiceDate,
            @Schema(description = "그날 마지막 면접의 회사명", example = "○○전자") String companyName,
            @Schema(
                            description = "그날 가장 많이 오른 기준. 오른 기준이 없으면 DELIVERY. 첫 연습일이면 null",
                            nullable = true)
                    Criterion criterion,
            @Schema(
                            description =
                                    "그 기준의 변화량(0 이상). \"전달력 +8\". 오른 기준이 없으면 0(\"전달력 +0\"). 첫 연습일이면"
                                            + " null",
                            nullable = true,
                            example = "8")
                    Integer delta) {}

    public record CriterionReview(
            @Schema(description = "평가 기준") Criterion criterion,
            @Schema(description = "한국 시간 그날 시작한 면접 중 결과가 나온 면접들의 평균 점수(0~100)", example = "70")
                    int score,
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
            @Schema(description = "한국 시간 면접 시작 날짜 기준 연습일") LocalDate practiceDate,
            @Schema(description = "첫 연습일이면 true → S08-C") boolean isFirst,
            @Schema(description = "비교한 직전 연습일. 첫 연습일이면 null", nullable = true)
                    LocalDate comparedDate,
            @Schema(
                            description = "그날 기준 스트릭. \"8일째 연습 완료!\". 설문 유도(3·7·21일째) 판단에도 쓴다",
                            example = "8")
                    int streakOnDate,
            @Schema(description = "그날 포함 최근 7일 중 연습한 날. 동그라미") List<LocalDate> practiceDates,
            @Schema(description = "한국 시간 그날 시작한 연습 면접 수", example = "1") int interviewCount,
            @Schema(description = "한국 시간 그날 시작한 연습 면접의 전체 시간 합(분)", example = "18")
                    int practiceMinutes,
            @Schema(description = "기준 4개") List<CriterionReview> criteria,
            @Schema(description = "다음에 해볼 것. 그날 마지막 면접의 한 문장(그날 앞선 면접까지 반영). 없으면 빈 배열")
                    List<String> nextActions) {}
}
