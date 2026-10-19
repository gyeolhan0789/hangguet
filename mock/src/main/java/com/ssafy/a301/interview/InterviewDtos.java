package com.ssafy.a301.interview;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.time.OffsetDateTime;
import java.util.List;

public final class InterviewDtos {

    private InterviewDtos() {}

    @Schema(description = "면접관. DEVIL 악마 면접관 · COFFEE_CHAT 개발자 커피챗")
    public enum Persona {
        DEVIL,
        COFFEE_CHAT
    }

    @Schema(description = "면접 방식. VIDEO 화상 · CHAT 채팅")
    public enum Mode {
        VIDEO,
        CHAT
    }

    @Schema(
            description =
                    "면접 상태. READY 시작 전 · IN_PROGRESS 면접 중 · ANALYZING 결과 생성 중 · COMPLETED 결과 있음 ·"
                            + " ABORTED 답변 없이 끝남 · FAILED 결과 생성 실패")
    public enum SessionStatus {
        READY,
        IN_PROGRESS,
        ANALYZING,
        COMPLETED,
        ABORTED,
        FAILED
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
                    String audioObjectKey,
            @Schema(
                            description =
                                    "음성 인식(5.10)이 확정한 토큰과 말한 시각. VOICE일 때만 보내며 없어도 된다."
                                            + " 말하기 지표 계산에 쓴다",
                            nullable = true)
                    @Size(max = 10_000, message = "최대 10,000개입니다.")
                    List<@NotNull(message = "필수 값입니다.") @Valid TranscriptToken> tokens) {}

    public record TranscriptToken(
            @Schema(description = "음성 인식이 확정한 토큰 글자. 단어 일부나 공백일 수 있다", example = "응답")
                    @NotEmpty(message = "필수 값입니다.")
                    String text,
            @Schema(description = "토큰을 말하기 시작한 시각(밀리초). 답변 음성 파일 시작 기준", example = "320")
                    @NotNull(message = "필수 값입니다.")
                    @PositiveOrZero(message = "0 이상입니다.")
                    Integer startMs,
            @Schema(description = "토큰을 말하기 끝낸 시각(밀리초). startMs 이상", example = "600")
                    @NotNull(message = "필수 값입니다.")
                    @PositiveOrZero(message = "0 이상입니다.")
                    Integer endMs) {}

    public record AnswerResponse(
            @Schema(description = "답변 id", example = "903") long id,
            @Schema(description = "질문 id", example = "303") long questionId,
            InputType inputType,
            @Schema(description = "제출 일시") OffsetDateTime createdAt,
            @Schema(description = "마지막 질문이었으면 true → 화면이 면접 끝내기(5.8) 호출. false면 다음 질문을 기다린다")
                    boolean isLastQuestion) {}

    @Schema(description = "면접관이 말을 끊는 이유. OFF_TOPIC 질문과 관계없는 이야기 · TOO_LONG 너무 긴 답변")
    public enum InterruptReason {
        OFF_TOPIC,
        TOO_LONG
    }

    public record ReactionRequest(
            @Schema(description = "답변 안에서 몇 번째 문장인지(1부터)", example = "3")
                    @NotNull(message = "필수 값입니다.")
                    @Positive(message = "1 이상입니다.")
                    Integer seq,
            @Schema(description = "음성 인식이 확정한 문장(1~1,000자)", example = "그래서 조회 응답 시간을 40% 줄였습니다.")
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 1_000, message = "1~1,000자입니다.")
                    String text,
            @Schema(description = "문장을 말한 뒤 쉰 시간(밀리초)", example = "420")
                    @NotNull(message = "필수 값입니다.")
                    @PositiveOrZero(message = "0 이상입니다.")
                    Integer pauseMs) {}

    public record Reaction(
            @Schema(
                            description = "리액션 종류. state 면접관 상태 · expression 표정 · gesture 동작",
                            allowableValues = {"state", "expression", "gesture"},
                            example = "gesture")
                    String type,
            @Schema(
                            description = "type이 state일 때만 값",
                            allowableValues = {"idle", "listening", "thinking", "speaking"},
                            nullable = true)
                    String state,
            @Schema(
                            description = "type이 expression일 때만 값",
                            allowableValues = {"smile", "frown", "smirk"},
                            nullable = true)
                    String expression,
            @Schema(
                            description = "type이 gesture일 때만 값",
                            allowableValues = {"small_nod", "nod", "tilt"},
                            nullable = true)
                    String gesture,
            @Schema(description = "세기(0~1). 표정 이미지 방식은 무시한다", nullable = true, example = "0.6")
                    Double intensity,
            @Schema(description = "리액션을 유지하는 시간(밀리초)", example = "1200") int durationMs,
            @Schema(description = "요청을 보낸 뒤 이 시간이 지나 도착하면 버린다(밀리초)", example = "1500") int ttlMs,
            @Schema(description = "리액션을 정한 곳. 이 API는 항상 server", example = "server")
                    String source) {}

    public record Attitude(
            @Schema(description = "관심(0~1)", example = "0.7") double interest,
            @Schema(description = "신뢰(0~1)", example = "0.6") double trust,
            @Schema(description = "긴장(0~1)", example = "0.2") double tension) {}

    public record Interrupt(
            InterruptReason reason,
            @Schema(description = "면접관이 하는 말. 자막으로 보여 준다", example = "질문으로 다시 돌아가 볼게요.")
                    String text) {}

    public record ReactionResponse(
            @Schema(description = "요청의 seq. 응답이 순서와 다르게 오면 가장 큰 seq의 응답만 쓴다", example = "3")
                    int seq,
            @Schema(description = "이 문장에 대한 면접관 리액션. 반응하지 않을 때는 null", nullable = true)
                    Reaction reaction,
            @Schema(description = "지금까지 답변을 듣고 쌓인 면접관 태도. 표정이 서서히 바뀌는 데 쓴다") Attitude attitude,
            @Schema(description = "면접관이 말을 끊을 때만 값이 있다", nullable = true) Interrupt interrupt) {}

    public record SttTokenResponse(
            @Schema(description = "STT 회사 연결용 1회용 토큰. 연결 1번에만 쓸 수 있다") String token,
            @Schema(description = "토큰 만료 일시. 지나면 다시 발급받는다") OffsetDateTime expiresAt) {}

    public record TtsTokenResponse(
            @Schema(description = "TTS 회사 연결용 1회용 토큰. 연결 1번에만 쓸 수 있다") String token,
            @Schema(description = "토큰 만료 일시. 지나면 다시 발급받는다") OffsetDateTime expiresAt,
            @Schema(description = "면접관 음성 id. 면접관(persona)에 맞춰 서버가 정한다") String voiceId,
            @Schema(description = "음성 합성 모델 id. 서버가 정한다") String modelId) {}

    @Schema(description = "202 대기 상태 본문(오류 아님)")
    public record PendingResponse(@Schema(example = "QUESTION_GENERATING") String code) {}
}
