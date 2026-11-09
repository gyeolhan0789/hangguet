package com.ssafy.a301.interview;

import com.ssafy.a301.growth.GrowthDtos.Criterion;
import com.ssafy.a301.growth.GrowthDtos.Grade;
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

    @Schema(description = "면접관. DEVIL 악마 면접관 · COFFEE_CHAT 개발자 면접관 · DUCK 오리 면접관")
    public enum Persona {
        DEVIL,
        COFFEE_CHAT,
        DUCK
    }

    @Schema(description = "면접 방식. VIDEO 화상 · CHAT 채팅")
    public enum Mode {
        VIDEO,
        CHAT
    }

    @Schema(
            description =
                    "면접 상태. READY 시작 전 · IN_PROGRESS 면접 중 · ANALYZING 결과 생성 중 · COMPLETED 결과 있음 ·"
                        + " ABORTED 답변 없이 끝남 · FAILED 결과 생성 실패 · START_FAILED 배정 거절로 시작 못 함(예정. 실제"
                        + " 백엔드는 아직 주지 않음)")
    public enum SessionStatus {
        READY,
        IN_PROGRESS,
        ANALYZING,
        COMPLETED,
        ABORTED,
        FAILED,
        START_FAILED
    }

    @Schema(
            description =
                    "면접 플랜(질문·평가 기준) 상태. GENERATING 만드는 중(S05 [면접 시작] 비활성) · READY 완료 · FAILED"
                            + " 실패(5.3으로 재시도)")
    public enum PlanStatus {
        GENERATING,
        READY,
        FAILED
    }

    @Schema(
            description =
                    "결과 생성 단계(S06-1 체크 목록). ORGANIZING_ANSWERS 답변 정리 → SCORING 기준별 분석 →"
                            + " WRITING_FEEDBACK 피드백 작성")
    public enum AnalysisStep {
        ORGANIZING_ANSWERS,
        SCORING,
        WRITING_FEEDBACK
    }

    @Schema(description = "답변 입력 방식. VOICE 화상(음성) · TEXT 채팅")
    public enum InputType {
        VOICE,
        TEXT
    }

    public record SessionCreateRequest(
            @Schema(description = "면접에 쓸 본인 지원서 id", example = "10")
                    @NotNull(message = "필수 값입니다.")
                    @Positive(message = "지원서 id입니다.")
                    Long applicationId,
            @Schema(description = "면접관(S04)", example = "DEVIL") @NotNull(message = "필수 값입니다.")
                    Persona persona,
            @Schema(description = "면접 방식(S05-1)", example = "VIDEO") @NotNull(message = "필수 값입니다.")
                    Mode mode) {}

    public record SessionEndRequest(
            @Schema(
                            description =
                                    "화상 면접 동안 면접관을 바라본 시간 비율(%). 화면이 면접 내내 브라우저에서 잰 값이다."
                                            + " 재지 못했거나 채팅이면 보내지 않는다",
                            example = "72.5")
                    @DecimalMin(value = "0", message = "0~100입니다.")
                    @DecimalMax(value = "100", message = "0~100입니다.")
                    BigDecimal gazeRatio) {}

    public record CriterionGrade(Criterion criterion, Grade grade) {}

    public record SessionListItem(
            @Schema(description = "면접 id", example = "55") long id,
            @Schema(description = "지원 회사명", example = "○○전자") String companyName,
            @Schema(description = "지원 직무", example = "백엔드 개발자") String jobTitle,
            Persona persona,
            Mode mode,
            @Schema(description = "ANALYZING · COMPLETED · FAILED만 포함") SessionStatus status,
            @Schema(description = "면접 시작 일시. 한국 시간 날짜로 목록을 조회한다") OffsetDateTime startedAt,
            @Schema(description = "면접 종료 일시") OffsetDateTime endedAt,
            @Schema(description = "제출한 답변 수. 1 이상", example = "5") int answeredCount,
            @Schema(description = "6.3의 한 줄 총평. 완료 전이거나 총평이 없으면 null", nullable = true)
                    String summary,
            @Schema(description = "완료된 면접의 기준별 등급 4개. 분석 중·실패는 빈 배열")
                    List<CriterionGrade> criterionGrades,
            @Schema(description = "그룹 면접이면 그룹 id. 개인 면접은 null", nullable = true, example = "7")
                    Long groupId) {}

    public record PageMetadata(int size, int number, long totalElements, int totalPages) {}

    public record SessionListSummary(
            @Schema(description = "날짜와 무관한 본인의 전체 연습 면접 수", example = "4") long totalInterviewCount,
            @Schema(description = "선택 시작 날짜 전체 연습 시간 합(분). 페이지가 달라도 같다", example = "32")
                    long practiceMinutes) {}

    public record SessionListResponse(
            List<SessionListItem> content, PageMetadata page, SessionListSummary summary) {}

    public record SessionCalendarDay(
            @Schema(description = "한국 시간 면접 시작 날짜", example = "2026-10-01") LocalDate practiceDate,
            @Schema(description = "해당 날짜의 연습 면접 수. 기록이 없으면 0", example = "0")
                    long interviewCount) {}

    public record SessionCalendarResponse(
            @Schema(description = "조회한 월(YYYY-MM)", example = "2026-10") String month,
            @Schema(description = "조회 월의 모든 날짜. 날짜 오름차순이며 기록이 없는 날짜도 포함한다")
                    List<SessionCalendarDay> content) {}

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
            Mode mode,
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
                                    "이번에 끝낸 면접의 한국 시간 시작 날짜로 스트릭이 올라 뱃지 구간이 바뀌었으면 true. 5.8 응답에만 값이"
                                            + " 있고, 그 외에는 null",
                            nullable = true)
                    Boolean leveledUp,
            @Schema(description = "면접방 입장 정보. 5.4 응답에만 값이 있고, 그 외에는 null", nullable = true)
                    RoomResponse room,
            @Schema(description = "그룹 면접이면 그룹 정보(API 명세 10.10). 개인 면접은 null", nullable = true)
                    SessionGroup group) {}

    @Schema(
            description =
                    "그룹 상태. WAITING 대기실 · IN_PROGRESS 진행 중 · START_FAILED 시작 실패(방장이 다시 시작) · ENDED"
                            + " 끝남 · CANCELLED 취소(모두 나감 · 만든 지 1시간)")
    public enum GroupStatus {
        WAITING,
        IN_PROGRESS,
        START_FAILED,
        ENDED,
        CANCELLED
    }

    @Schema(description = "면접이 속한 그룹(API 명세 10.10)")
    public record SessionGroup(
            @Schema(description = "그룹 id", example = "7") long groupId, GroupStatus status) {}

    @Schema(description = "면접방(LiveKit) 입장 정보(5.4·5.14)")
    public record RoomResponse(
            @Schema(description = "면접방 주소", example = "wss://rtc.hangguet.co.kr") String url,
            @Schema(description = "입장 토큰. 이 면접의 방 하나·본인에게만 권한이 있다") String token,
            @Schema(description = "토큰 만료 일시. 지나면 5.14로 다시 받는다") OffsetDateTime expiresAt) {}

    public record QuestionResponse(
            @Schema(description = "질문 id", example = "303") long id,
            @Schema(description = "질문 순서(1부터)", example = "3") int seq,
            @Schema(description = "질문 내용") String content,
            @Schema(description = "질문을 낸 일시") OffsetDateTime createdAt) {}

    public record AnswerRequest(
            @Schema(description = "TEXT(채팅)만 가능하다. 화상 답변은 이 API를 쓰지 않는다", example = "TEXT")
                    @NotNull(message = "필수 값입니다.")
                    InputType inputType,
            @Schema(description = "입력한 답변 글(1~1,000자)")
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 1_000, message = "1~1,000자입니다.")
                    String content) {}

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
