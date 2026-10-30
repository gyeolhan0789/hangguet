package com.ssafy.a301.interview.dto;

import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.Grade;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

public final class InterviewDtos {

    private InterviewDtos() {}

    public record SessionCreateRequest(
            @Schema(description = "면접에 쓸 본인 지원서 id", example = "10")
                    @NotNull(message = "필수 값입니다.")
                    @Positive(message = "지원서 id입니다.")
                    Long applicationId,
            @Schema(description = "면접관(S04)", example = "DEVIL") @NotNull(message = "필수 값입니다.")
                    Persona persona,
            @Schema(description = "면접 방식(S05-1)", example = "VIDEO") @NotNull(message = "필수 값입니다.")
                    InterviewMode mode) {}

    public record CurrentQuestion(
            @Schema(description = "질문 id", example = "303") long id,
            @Schema(description = "질문 순서(1부터). \"질문 3 / 5\"의 3", example = "3") int seq,
            @Schema(description = "질문 내용") String content) {}

    public record SessionResponse(
            @Schema(description = "면접 id", example = "55") long id,
            @Schema(description = "지원서 id", example = "10") long applicationId,
            @Schema(description = "지원 회사명", example = "○○전자") String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자") String jobTitle,
            Persona persona,
            InterviewMode mode,
            SessionStatus status,
            PlanStatus planStatus,
            @Schema(
                            description =
                                    "면접 플랜 준비 진행률(0~100). S05-E \"질문 준비 78%\". planStatus가"
                                            + " GENERATING일 때만 값, 나머지는 null",
                            nullable = true,
                            example = "78")
                    Integer planProgress,
            @Schema(description = "status가 ANALYZING일 때만 값, 나머지는 null", nullable = true)
                    AnalysisStep analysisStep,
            @Schema(description = "지금 답할 질문. 면접 중이 아니거나 다음 질문을 만드는 중이면 null", nullable = true)
                    CurrentQuestion currentQuestion,
            @Schema(description = "지금까지 낸 답변 수. S06-E \"답변한 2개 질문까지\"", example = "2")
                    int answeredCount,
            @Schema(
                            description = "면접 경과 시간(초). S06 \"08:42\". 연결이 끊겨 멈춘 시간은 빠진다. 시작 전이면 0",
                            example = "522")
                    int elapsedSeconds,
            @Schema(description = "면접 시작 일시. 시작 전이면 null", nullable = true)
                    OffsetDateTime startedAt,
            @Schema(description = "면접 종료 일시. 끝나기 전이면 null", nullable = true) OffsetDateTime endedAt,
            @Schema(description = "면접을 만든 일시") OffsetDateTime createdAt,
            @Schema(
                            description =
                                    "이번에 끝낸 면접으로 스트릭이 올라 뱃지 구간이 바뀌었으면 true. 5.8 응답에만 값이 있고, 그 외에는"
                                            + " null",
                            nullable = true)
                    Boolean leveledUp,
            @Schema(description = "면접방 입장 정보. 5.4 응답에만 값이 있고, 그 외에는 null", nullable = true)
                    RoomResponse room) {}

    @Schema(description = "면접방(LiveKit) 입장 정보(5.4·5.14)")
    public record RoomResponse(
            @Schema(description = "면접방 주소", example = "wss://rtc.hangguet.co.kr") String url,
            @Schema(description = "입장 토큰. 이 면접의 방 하나·본인에게만 권한이 있다") String token,
            @Schema(description = "토큰 만료 일시. 지나면 5.14로 다시 받는다") OffsetDateTime expiresAt) {}

    public record CriterionGrade(Criterion criterion, Grade grade) {}

    public record SessionListItem(
            @Schema(description = "면접 id", example = "55") long id,
            @Schema(description = "지원 회사명", example = "○○전자") String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자") String jobTitle,
            Persona persona,
            InterviewMode mode,
            SessionStatus status,
            @Schema(description = "면접 시작 일시") OffsetDateTime startedAt,
            @Schema(description = "면접 종료 일시") OffsetDateTime endedAt,
            @Schema(description = "실제로 제출한 답변 수", example = "5") int answeredCount,
            @Schema(description = "완료된 면접의 한 줄 총평(6.3과 같음, 30자 이내)", nullable = true)
                    String summary,
            @Schema(description = "완료된 면접의 평가 기준별 등급") List<CriterionGrade> criterionGrades) {}

    public record PageMetadata(int size, int number, long totalElements, int totalPages) {}

    public record SessionListSummary(
            @Schema(description = "보관함 전체 연습 면접 수", example = "23") long totalInterviewCount,
            @Schema(description = "선택한 면접 시작 날짜의 총 연습 시간(분, 초 단위 합계를 내림)", example = "30")
                    long practiceMinutes) {}

    public record SessionListResponse(
            List<SessionListItem> content, PageMetadata page, SessionListSummary summary) {}

    public record DailyInterviewCount(
            @Schema(description = "면접 시작 날짜(한국 시간)") LocalDate practiceDate,
            @Schema(description = "해당 날짜의 연습 면접 수. 기록이 없으면 0") long interviewCount) {}

    public record SessionCalendarResponse(
            @Schema(description = "조회 월", example = "2026-10") String month,
            @Schema(description = "해당 월의 모든 날짜. 날짜 오름차순") List<DailyInterviewCount> content) {}

    public record QuestionResponse(
            @Schema(description = "질문 id", example = "303") long id,
            @Schema(description = "질문 순서(1부터)", example = "3") int seq,
            @Schema(description = "질문 내용") String content,
            @Schema(description = "질문을 낸 일시") OffsetDateTime createdAt) {}

    public record AnswerRequest(
            @Schema(
                            description =
                                    "TEXT(채팅)만 가능하다. 화상 답변은 AI 에이전트가 면접방에서 받아 저장하므로 이 API를 쓰지 않는다",
                            example = "TEXT")
                    @NotNull(message = "필수 값입니다.")
                    InputType inputType,
            @Schema(description = "입력한 답변 글(1~1,000자)")
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 1_000, message = "채팅 답변은 1~1,000자입니다.")
                    String content) {}

    public record SessionEndRequest(
            @Schema(
                            description =
                                    "화상 면접 동안 면접관을 바라본 시간 비율(%). 화면이 면접 내내 브라우저에서 잰 값이다."
                                            + " 재지 못했거나 채팅이면 보내지 않는다",
                            example = "72.5")
                    @DecimalMin(value = "0", message = "0~100입니다.")
                    @DecimalMax(value = "100", message = "0~100입니다.")
                    BigDecimal gazeRatio) {}

    public record AnswerResponse(
            @Schema(description = "답변 id", example = "903") long id,
            @Schema(description = "질문 id", example = "303") long questionId,
            InputType inputType,
            @Schema(description = "제출 일시") OffsetDateTime createdAt,
            @Schema(description = "마지막 질문이었으면 true → 화면이 면접 끝내기(5.8) 호출. false면 다음 질문을 기다린다")
                    boolean isLastQuestion) {}

    @Schema(description = "202 대기 상태 본문(오류 아님)")
    public record PendingResponse(@Schema(example = "QUESTION_GENERATING") String code) {}
}
