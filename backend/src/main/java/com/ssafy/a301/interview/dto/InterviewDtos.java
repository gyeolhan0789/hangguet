package com.ssafy.a301.interview.dto;

import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionStatus;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;

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
                    Boolean leveledUp) {}

    public record QuestionResponse(
            @Schema(description = "질문 id", example = "303") long id,
            @Schema(description = "질문 순서(1부터)", example = "3") int seq,
            @Schema(description = "질문 내용") String content,
            @Schema(description = "질문을 낸 일시") OffsetDateTime createdAt) {}

    public record AnswerAudioUploadUrlRequest(
            @Schema(
                            description = "녹음 형식",
                            allowableValues = {"audio/webm", "audio/ogg", "audio/mp4"},
                            example = "audio/webm")
                    @NotBlank(message = "필수 값입니다.")
                    @Pattern(
                            regexp = "audio/webm|audio/ogg|audio/mp4",
                            message = "audio/webm·audio/ogg·audio/mp4만 가능합니다.")
                    String contentType) {}

    public record AnswerRequest(
            @Schema(description = "VOICE(화상) | TEXT(채팅). 면접 방식(mode)과 같아야 한다", example = "VOICE")
                    @NotNull(message = "필수 값입니다.")
                    InputType inputType,
            @Schema(
                            description =
                                    "답변 글. 채팅은 입력한 글(1~1,000자), 화상은 실시간 음성 인식(5.10)의 최종"
                                            + " 결과(1~10,000자)")
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 10_000, message = "TEXT 1~1,000자, VOICE 1~10,000자입니다.")
                    String content,
            @Schema(
                            description = "답변 음성 키. VOICE일 때 필수. 5.6에서 받은 objectKey",
                            nullable = true,
                            example = "sessions/55/answers/303.webm")
                    String audioObjectKey) {}

    public record AnswerResponse(
            @Schema(description = "답변 id", example = "903") long id,
            @Schema(description = "질문 id", example = "303") long questionId,
            InputType inputType,
            @Schema(description = "제출 일시") OffsetDateTime createdAt,
            @Schema(description = "마지막 질문이었으면 true → 화면이 면접 끝내기(5.8) 호출. false면 다음 질문을 기다린다")
                    boolean isLastQuestion) {}

    public record SttTokenResponse(
            @Schema(description = "Soniox 실시간 음성 인식 1회용 임시 키. 연결 1번에만 쓸 수 있어 답변마다 새로 받는다")
                    String token,
            @Schema(description = "이 시각 전에 연결을 시작해야 한다. 지나면 다시 발급받는다") OffsetDateTime expiresAt) {}

    @Schema(description = "202 대기 상태 본문(오류 아님)")
    public record PendingResponse(@Schema(example = "QUESTION_GENERATING") String code) {}
}
