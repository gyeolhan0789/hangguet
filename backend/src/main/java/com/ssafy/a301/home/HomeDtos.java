package com.ssafy.a301.home;

import com.ssafy.a301.growth.GrowthDtos.RecentReviewItem;
import com.ssafy.a301.interview.domain.Criterion;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

public final class HomeDtos {

    private HomeDtos() {}

    @Schema(
            description =
                    "어떤 홈을 그릴지. NOT_DONE_TODAY 오늘 미완료(S02) · DONE_TODAY 오늘 완료(S02-B) · BROKEN 스트릭"
                            + " 끊김(S02-C) · FIRST_VISIT 연습 기록 없음(S02-D)")
    public enum HomeState {
        NOT_DONE_TODAY,
        DONE_TODAY,
        BROKEN,
        FIRST_VISIT
    }

    public record Improvement(
            @Schema(description = "평가 기준") Criterion criterion,
            @Schema(description = "직전 연습일 대비 오른 점수", example = "8") int delta) {}

    public record HomeResponse(
            HomeState homeState,
            @Schema(description = "현재 스트릭. 오늘 연습했으면 오늘 포함", example = "7") int currentStreak,
            @Schema(description = "가장 길었던 스트릭. S02-C \"지난 최고 기록\"", example = "7") int bestStreak,
            @Schema(description = "마지막 연습으로 뱃지 구간이 바뀌었으면 true → S02-L") boolean leveledUpToday,
            @Schema(description = "오늘 포함 최근 7일 중 연습한 날. 이번 주 동그라미") List<LocalDate> practiceDates,
            @Schema(description = "오늘 연습 면접 수. S02-B \"면접 1회\"", example = "0")
                    int todayInterviewCount,
            @Schema(description = "오늘 연습 면접 시간 합(분). S02-B \"18분\"", example = "0")
                    int todayPracticeMinutes,
            @Schema(
                            description =
                                    "오늘 점수가 오른 기준, 많이 오른 순. S02-B \"전달력 +8 · 논리성 +4\". 오늘 연습 전이거나 첫"
                                            + " 연습일이면 빈 배열")
                    List<Improvement> todayImprovements,
            @Schema(description = "직전 성장 리뷰의 \"다음에 해볼 것\". S02 \"어제의 나에게서\". 없으면 빈 배열")
                    List<String> nextActions,
            @Schema(description = "그 성장 리뷰의 날짜. S02 \"10.12 성장 리뷰의…\". 없으면 null", nullable = true)
                    LocalDate nextActionsDate,
            @Schema(description = "최근 성장 리뷰 2개(7.2 항목 형식), 최근 날짜 순. S02-C \"지난번 마지막 연습\"은 첫 항목")
                    List<RecentReviewItem> recentReviews) {}

    public record StatsResponse(
            @Schema(description = "현재 스트릭", example = "7") int currentStreak,
            @Schema(description = "최장 스트릭", example = "12") int bestStreak,
            @Schema(description = "연습 면접 수. \"총 면접 23회\"", example = "23") int totalInterviewCount,
            @Schema(description = "연습 면접 시간 합(분). \"총 연습 시간 6시간 40분\"", example = "400")
                    int totalPracticeMinutes,
            @Schema(
                            description = "가장 최근 면접에 쓴 지원서의 직무. \"백엔드 개발자 준비 중\". 면접 기록이 없으면 null",
                            nullable = true,
                            example = "백엔드 개발자")
                    String latestJobTitle) {}

    public record PracticeLogItem(
            @Schema(description = "연습한 날") LocalDate practiceDate,
            @Schema(description = "그날 처음 면접을 마친 일시") OffsetDateTime createdAt) {}

    public record PracticeLogsResponse(
            @Schema(description = "그달 연습한 날, 날짜 오름차순. 한 달 최대 31건이라 페이지 없음")
                    List<PracticeLogItem> content) {}
}
