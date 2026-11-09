package com.ssafy.a301.result.dto;

import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.Grade;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.Persona;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;

public final class ResultDtos {

    private ResultDtos() {}

    public enum VideoStatus {
        READY,
        MERGING,
        FAILED
    }

    public record SessionScore(
            Criterion criterion,
            @Schema(description = "점수(0~100). 답한 질문들의 이 기준 판정 점수 평균", example = "82") int score,
            @Schema(description = "3단계") Grade grade,
            @Schema(description = "한 줄 설명. 성장 리뷰의 \"다음에 해볼 것\"에도 쓰인다", nullable = true)
                    String comment) {}

    public record AnswerFeedback(
            @Schema(description = "질문 id", example = "302") long questionId,
            @Schema(description = "질문 순서", example = "2") int seq,
            @Schema(description = "질문 내용") String question,
            @Schema(description = "내 답변(화상은 음성 인식한 글)") String content,
            @Schema(description = "점수(0~100)", example = "85") int score,
            @Schema(description = "3단계") Grade grade,
            @Schema(description = "잘한 점", nullable = true) String goodPoint,
            @Schema(description = "아쉬운 점. 성장 리뷰의 \"다음에 해볼 것\"에도 쓰인다", nullable = true)
                    String improvePoint) {}

    @Schema(description = "음성 지표. 값을 구하지 못한 항목은 null")
    public record SpeechMetrics(
            @Schema(description = "1분당 군말('음', '어') 횟수", nullable = true, example = "2.1")
                    BigDecimal fillerPerMin,
            @Schema(description = "문장 중간에 길게 멈춘 횟수", nullable = true, example = "3")
                    Integer longPauseCount,
            @Schema(
                            description = "일반 성인 말 속도와의 차이(%, 기준은 AI 명세 4장)",
                            nullable = true,
                            example = "8.5")
                    BigDecimal speedDeviationPct,
            @Schema(description = "말끝을 흐린 문장 비율(%)", nullable = true, example = "12.0")
                    BigDecimal trailingOffRatio,
            @Schema(description = "억양 변화 폭(세미톤)", nullable = true, example = "6.2")
                    BigDecimal pitchRangeSt,
            @Schema(
                            description =
                                    "면접 동안 면접관을 바라본 시간 비율(%). 화면이 브라우저에서 재어 면접 끝내기(5.8)로 보낸 값이고, 받지"
                                            + " 못했으면 null",
                            nullable = true,
                            example = "71.5")
                    BigDecimal gazeRatio) {}

    public record ResultResponse(
            @Schema(description = "면접 id", example = "55") long id,
            Persona persona,
            InterviewMode mode,
            @Schema(description = "지원 회사명", example = "○○전자") String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자") String jobTitle,
            @Schema(description = "맨 위 한 줄 총평(30자 이내). 없으면 null", nullable = true) String summary,
            @Schema(description = "면접 시작 일시. 화면의 \"18분\"은 endedAt과의 차이") OffsetDateTime startedAt,
            @Schema(description = "면접 종료 일시") OffsetDateTime endedAt,
            @Schema(description = "평가 기준 4개") List<SessionScore> sessionScores,
            @Schema(description = "질문별 피드백, 질문 순") List<AnswerFeedback> answers,
            @Schema(description = "음성 지표. 채팅 면접이면 null", nullable = true)
                    SpeechMetrics speechMetrics,
            @Schema(
                            description =
                                    "그룹 면접이 AI 면접관 장애로 중간에 끝나 일부 답변으로 만든 결과면 true. 그 밖에는 false",
                            example = "false")
                    boolean partial) {}

    public record ReplayItem(
            @Schema(description = "질문 id", example = "301") long questionId,
            @Schema(description = "질문 순서", example = "1") int seq,
            @Schema(description = "질문 내용") String question,
            @Schema(
                            description =
                                    "질문 음성을 송출하기 시작한 일시. recordingStartedAt(null이면 startedAt)과의"
                                            + " 차이(초)가 영상 속 질문 위치(마커)")
                    OffsetDateTime questionCreatedAt,
            @Schema(description = "답변 글. 재생 중 자막(답변 단위)", nullable = true) String answer,
            @Schema(description = "답변 제출 일시", nullable = true) OffsetDateTime answerCreatedAt,
            @Schema(description = "질문별 3단계", nullable = true) Grade grade,
            @Schema(
                            description =
                                    "다시보기 타임라인(화상만). 그 답변 동안의 면접 흐름 곡선과 평소보다 유난히 낮은 지점."
                                            + " 채팅 · 답하지 않은 질문 · 만들지 못한 답변은 null",
                            nullable = true)
                    ReplayTimeline timeline) {}

    /** 6.4 다시보기 타임라인(AI 명세 4장 다시보기 타임라인). 시각은 모두 영상 위치(초) */
    public record ReplayTimeline(
            @Schema(description = "1초 간격 곡선") List<TimelinePoint> points,
            @Schema(description = "평소보다 유난히 낮은 지점, 시간 순") List<TimelineCheckpoint> checkpoints) {}

    public record TimelinePoint(
            @Schema(description = "영상 위치(초)", example = "84.25") double at,
            @Schema(description = "그 면접 평균이 0인 표준화 값. 음수면 평소보다 아쉬움", example = "-0.42")
                    double value) {}

    public record TimelineCheckpoint(
            @Schema(description = "가장 낮은 지점(영상 위치, 초)", example = "131.25") double at,
            @Schema(description = "낮은 구간 시작(영상 위치, 초)", example = "130.25") double start,
            @Schema(description = "낮은 구간 끝(영상 위치, 초)", example = "135.25") double end,
            @Schema(description = "가장 낮은 지점의 표준화 값", example = "-2.1") double value,
            @Schema(description = "낮았던 이유. 이유마다 보완할 점") List<TimelineReason> reasons) {}

    public record TimelineReason(
            @Schema(
                            description =
                                    "STABILITY 안정감 · CONFIDENCE 자신감 · EXPRESSION 의사표현 · EMOTION 감정"
                                        + " 전달 · LIKEABILITY 매력도 · TRUST 신뢰도 · TRAILING_OFF 말끝 흐림 ·"
                                        + " FILLER 군말 · LONG_PAUSE 긴 멈춤",
                            example = "CONFIDENCE")
                    String metric,
            @Schema(description = "음성 이유의 앞뒤 5초 횟수. 인상 이유면 null", nullable = true, example = "3")
                    Integer count,
            @Schema(description = "보완할 점", example = "고개를 들고 화면 속 면접관을 보며 말해 보세요.") String text) {}

    public record ReplayResponse(
            @Schema(description = "면접 id", example = "55") long id,
            Persona persona,
            @Schema(description = "VIDEO면 영상, CHAT이면 대화 기록") InterviewMode mode,
            @Schema(description = "지원 회사명", example = "○○전자") String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자") String jobTitle,
            @Schema(description = "면접 시작 일시. 상단 날짜") OffsetDateTime startedAt,
            @Schema(
                            description =
                                    "합친 영상의 0초에 해당하는 시각(녹화 합치기에 사용한 트랙 중 가장 먼저 시작한 트랙의 시작 시각). 녹화"
                                            + " 시작 시각을 얻지 못해 트랙을 이어 붙여 합쳤거나 채팅이면 null이고, 이때 화면은"
                                            + " startedAt을 기준으로 사용한다",
                            nullable = true)
                    OffsetDateTime recordingStartedAt,
            @Schema(
                            description =
                                    "녹화 영상 상태. READY 재생 가능, MERGING 녹화 합치기 중(10초마다 다시 조회), FAILED"
                                            + " 합치기 실패(면접 종료 후 15분이 지나도 결과가 없을 때 포함). 채팅이면 null",
                            nullable = true)
                    VideoStatus videoStatus,
            @Schema(description = "녹화 영상 임시 주소(만료됨). videoStatus가 READY일 때만 값이 있다", nullable = true)
                    String videoUrl,
            @Schema(description = "질문 순") List<ReplayItem> items,
            @Schema(
                            description =
                                    "그룹 화상 면접만. 본인 답변 구간만 이어 붙인 영상의 구간 목록(시간 순). 질문 마커는 그 질문 구간의"
                                            + " videoStart다. 개인 면접 · 채팅이면 null",
                            nullable = true)
                    List<ReplaySegment> segments) {}

    /** 6.4 그룹 화상 면접의 본인 답변 구간(docs/그룹면접-설계.md 6.12) */
    public record ReplaySegment(
            @Schema(description = "질문 순서", example = "1") int seq,
            @Schema(description = "이어 붙인 영상에서 구간이 시작하는 위치(초, 소수 셋째 자리)", example = "0.0")
                    double videoStart,
            @Schema(description = "이어 붙인 영상에서 구간이 끝나는 위치(초)", example = "95.42") double videoEnd,
            @Schema(description = "구간이 시작한 원래 시각(질문을 낸 시각)") OffsetDateTime startedAt) {}
}
