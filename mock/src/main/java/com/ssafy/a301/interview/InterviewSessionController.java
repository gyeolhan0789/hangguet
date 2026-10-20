package com.ssafy.a301.interview;

import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.interview.InterviewDtos.AnswerAudioUploadUrlRequest;
import com.ssafy.a301.interview.InterviewDtos.AnswerRequest;
import com.ssafy.a301.interview.InterviewDtos.AnswerResponse;
import com.ssafy.a301.interview.InterviewDtos.InputType;
import com.ssafy.a301.interview.InterviewDtos.QuestionResponse;
import com.ssafy.a301.interview.InterviewDtos.ReactionRequest;
import com.ssafy.a301.interview.InterviewDtos.ReactionResponse;
import com.ssafy.a301.interview.InterviewDtos.SessionCreateRequest;
import com.ssafy.a301.interview.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.InterviewDtos.SttTokenResponse;
import com.ssafy.a301.interview.InterviewDtos.TranscriptToken;
import com.ssafy.a301.interview.InterviewDtos.TtsTokenResponse;
import com.ssafy.a301.user.UserDtos.UploadUrlResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "5. 면접 진행")
@RestController
@RequestMapping("/api/v1/interview-sessions")
public class InterviewSessionController {

    private static final String IDEMPOTENCY =
            "멱등 키(UUID). 같은 키·같은 본문이면 처음 결과를 그대로 반환, 같은 키·다른 본문이면 409 IDEMPOTENCY_KEY_REUSED";
    private static final String SESSION_ID = "면접 id. `0`이면 404(뼈대 서버)";

    private static final String CREATED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "READY",
              "planStatus": "GENERATING", "planProgress": 0, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 0,
              "startedAt": null, "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null }\
            """;
    private static final String S05_GENERATING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "READY",
              "planStatus": "GENERATING", "planProgress": 78, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 0,
              "startedAt": null, "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null }\
            """;
    private static final String S05_PLAN_FAILED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "READY",
              "planStatus": "FAILED", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 0,
              "startedAt": null, "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null }\
            """;
    private static final String STARTED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "IN_PROGRESS",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": { "id": 301, "seq": 1, "content": "1분 동안 자기소개 부탁드려요." },
              "answeredCount": 0, "elapsedSeconds": 0,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null }\
            """;
    private static final String S06_IN_PROGRESS =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "IN_PROGRESS",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": { "id": 303, "seq": 3, "content": "가장 큰 기술적 문제는 무엇이었나요?" },
              "answeredCount": 2, "elapsedSeconds": 522,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null }\
            """;
    private static final String S06_NEXT_GENERATING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "IN_PROGRESS",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 3, "elapsedSeconds": 640,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null }\
            """;
    private static final String S06_1_ANALYZING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "ANALYZING",
              "planStatus": "READY", "planProgress": null, "analysisStep": "SCORING",
              "currentQuestion": null, "answeredCount": 5, "elapsedSeconds": 1080,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:18:00+09:00", "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null }\
            """;
    private static final String S06_1_FAILED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "FAILED",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 5, "elapsedSeconds": 1080,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:18:00+09:00", "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null }\
            """;
    private static final String ENDED_ANALYZING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "ANALYZING",
              "planStatus": "READY", "planProgress": null, "analysisStep": "ORGANIZING_ANSWERS",
              "currentQuestion": null, "answeredCount": 2, "elapsedSeconds": 522,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:08:42+09:00", "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": true }\
            """;
    private static final String ENDED_ABORTED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "ABORTED",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 95,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:01:35+09:00", "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": false }\
            """;
    private static final String QUESTION =
            """
            { "id": 303, "seq": 3, "content": "흐음~ ○○ 프로젝트라. 거기서 '직접' 한 부분만 쏙 골라서 말해볼래요?",
              "createdAt": "2026-10-15T12:06:12+09:00" }\
            """;
    private static final String AUDIO_UPLOAD_URL =
            """
            { "uploadUrl": "https://…s3…?X-Amz-Signature=…", "objectKey": "sessions/55/answers/303.webm",
              "expiresAt": "2026-10-15T12:16:12+09:00" }\
            """;
    private static final String ANSWER_VOICE =
            """
            { "inputType": "VOICE", "content": "조회 응답 시간을 40% 줄였습니다.",
              "audioObjectKey": "sessions/55/answers/303.webm",
              "tokens": [ { "text": "조회", "startMs": 0, "endMs": 280 }, { "text": " ", "startMs": 280, "endMs": 320 },
                          { "text": "응답", "startMs": 320, "endMs": 600 }, { "text": " ", "startMs": 600, "endMs": 640 },
                          { "text": "시간", "startMs": 640, "endMs": 900 }, { "text": "을", "startMs": 900, "endMs": 1000 },
                          { "text": " ", "startMs": 1000, "endMs": 1180 }, { "text": "40", "startMs": 1180, "endMs": 1500 },
                          { "text": "%", "startMs": 1500, "endMs": 1700 }, { "text": " ", "startMs": 1700, "endMs": 1740 },
                          { "text": "줄", "startMs": 1740, "endMs": 1900 }, { "text": "였", "startMs": 1900, "endMs": 2050 },
                          { "text": "습니다", "startMs": 2050, "endMs": 2400 }, { "text": ".", "startMs": 2400, "endMs": 2400 } ] }\
            """;
    private static final String ANSWER_TEXT =
            """
            { "inputType": "TEXT", "content": "캐시 무효화 시점을 직접 설계했습니다." }\
            """;
    private static final String ANSWER_ACCEPTED =
            """
            { "id": 903, "questionId": 303, "inputType": "VOICE", "createdAt": "2026-10-15T12:08:40+09:00", "isLastQuestion": false }\
            """;
    private static final String REACTION_REQUEST =
            """
            { "seq": 3, "text": "그래서 조회 응답 시간을 40% 줄였습니다.", "pauseMs": 420 }\
            """;
    private static final String REACTION_REQUEST_CHAT =
            """
            { "seq": 7, "text": "캐시 무효화 시점을 직접 설계했고, 그 결과", "pauseMs": 800 }\
            """;
    private static final String REACTION_NOD =
            """
            { "seq": 3,
              "reaction": { "type": "gesture", "state": null, "expression": null, "gesture": "nod",
                            "intensity": 0.6, "durationMs": 1200, "ttlMs": 1500, "source": "server" },
              "attitude": { "interest": 0.7, "trust": 0.6, "tension": 0.2 },
              "interrupt": null }\
            """;
    private static final String REACTION_NONE =
            """
            { "seq": 4, "reaction": null,
              "attitude": { "interest": 0.7, "trust": 0.6, "tension": 0.2 },
              "interrupt": null }\
            """;
    private static final String REACTION_INTERRUPT =
            """
            { "seq": 9,
              "reaction": { "type": "expression", "state": null, "expression": "frown", "gesture": null,
                            "intensity": 0.5, "durationMs": 1500, "ttlMs": 1500, "source": "server" },
              "attitude": { "interest": 0.4, "trust": 0.5, "tension": 0.6 },
              "interrupt": { "reason": "OFF_TOPIC", "text": "질문으로 다시 돌아가 볼게요." } }\
            """;
    private static final String STT_TOKEN =
            """
            { "token": "…", "expiresAt": "2026-10-15T12:16:00+09:00" }\
            """;
    private static final String TTS_TOKEN =
            """
            { "token": "…", "expiresAt": "2026-10-15T12:21:12+09:00", "voiceId": "…", "modelId": "…" }\
            """;

    private final Stub stub;
    private final SonioxClient soniox;
    private final ElevenLabsClient elevenLabs;

    public InterviewSessionController(Stub stub, SonioxClient soniox, ElevenLabsClient elevenLabs) {
        this.stub = stub;
        this.soniox = soniox;
        this.elevenLabs = elevenLabs;
    }

    @Operation(summary = "5.1 면접 만들기", description = "면접을 만들고 질문 준비를 시작한다. 준비가 끝났는지는 5.2로 확인한다.")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(
            content =
                    @Content(
                            examples =
                                    @ExampleObject(
                                            value =
                                                    """
                                                    { "applicationId": 10, "persona": "DEVIL", "mode": "VIDEO" }\
                                                    """)))
    @ApiResponse(
            responseCode = "201",
            content = @Content(examples = @ExampleObject(value = CREATED)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "APPLICATION_NOT_FOUND",
                                            value = ErrorExamples.APPLICATION_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "IDEMPOTENCY_KEY_REUSED",
                                            value = ErrorExamples.IDEMPOTENCY_KEY_REUSED)))
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SessionResponse create(
            @Parameter(description = IDEMPOTENCY) @RequestHeader("Idempotency-Key")
                    UUID idempotencyKey,
            @Valid @RequestBody SessionCreateRequest request) {
        Stub.notFoundIfZero(request.applicationId(), ErrorCode.APPLICATION_NOT_FOUND);
        return stub.read(CREATED, SessionResponse.class);
    }

    @Operation(
            summary = "5.2 면접 조회",
            description = "면접의 현재 상태를 준다. 질문 준비와 결과 분석이 끝났는지 이 API를 2초마다(임시 값) 불러 확인한다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(
                                        name = "S05·S05-E 질문 준비 78%",
                                        value = S05_GENERATING),
                                @ExampleObject(name = "S05 플랜 생성 실패", value = S05_PLAN_FAILED),
                                @ExampleObject(name = "S06·S06-B 면접 중", value = S06_IN_PROGRESS),
                                @ExampleObject(
                                        name = "S06 다음 질문 생성 중",
                                        value = S06_NEXT_GENERATING),
                                @ExampleObject(name = "S06-1 결과 분석 중", value = S06_1_ANALYZING),
                                @ExampleObject(name = "S06-1 실패", value = S06_1_FAILED)
                            }))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SESSION_NOT_FOUND",
                                            value = ErrorExamples.SESSION_NOT_FOUND)))
    @GetMapping("/{sessionId}")
    public SessionResponse get(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return stub.read(S06_IN_PROGRESS, SessionResponse.class);
    }

    @Operation(summary = "5.3 면접 플랜 재생성")
    @ApiResponse(
            responseCode = "202",
            content = @Content(examples = @ExampleObject(value = CREATED)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SESSION_NOT_FOUND",
                                            value = ErrorExamples.SESSION_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "PLAN_NOT_FAILED",
                                            value = ErrorExamples.PLAN_NOT_FAILED)))
    @PostMapping("/{sessionId}/plan/retry")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public SessionResponse retryPlan(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return stub.read(CREATED, SessionResponse.class);
    }

    @Operation(summary = "5.4 면접 시작", description = "면접을 시작하고 첫 질문을 준다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = STARTED)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SESSION_NOT_FOUND",
                                            value = ErrorExamples.SESSION_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "PLAN_NOT_READY",
                                        value = ErrorExamples.PLAN_NOT_READY),
                                @ExampleObject(
                                        name = "INVALID_SESSION_STATE",
                                        value = ErrorExamples.INVALID_SESSION_STATE),
                                @ExampleObject(
                                        name = "IDEMPOTENCY_KEY_REUSED",
                                        value = ErrorExamples.IDEMPOTENCY_KEY_REUSED)
                            }))
    @PostMapping("/{sessionId}/start")
    public SessionResponse start(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId,
            @Parameter(description = IDEMPOTENCY) @RequestHeader("Idempotency-Key")
                    UUID idempotencyKey) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return stub.read(STARTED, SessionResponse.class);
    }

    @Operation(
            summary = "5.5 지금 질문",
            description = "지금 답할 질문을 준다. 다음 질문을 준비 중이면 202를 주며, 2초 뒤(임시 값) 다시 부른다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            schema = @Schema(implementation = QuestionResponse.class),
                            examples = @ExampleObject(value = QUESTION)))
    @ApiResponse(
            responseCode = "202",
            content =
                    @Content(
                            schema = @Schema(implementation = InterviewDtos.PendingResponse.class),
                            examples =
                                    @ExampleObject(
                                            value = "{ \"code\": \"QUESTION_GENERATING\" }")))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SESSION_NOT_FOUND",
                                            value = ErrorExamples.SESSION_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "INVALID_SESSION_STATE",
                                            value = ErrorExamples.INVALID_SESSION_STATE)))
    @GetMapping("/{sessionId}/questions/current")
    public ResponseEntity<?> currentQuestion(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return ResponseEntity.ok(stub.read(QUESTION, QuestionResponse.class));
    }

    @Operation(
            summary = "5.6 답변 음성 업로드 주소",
            description = "답변 음성을 올릴 주소를 준다. 받은 `objectKey`는 5.7의 `audioObjectKey`로 보낸다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = AUDIO_UPLOAD_URL)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "SESSION_NOT_FOUND",
                                        value = ErrorExamples.SESSION_NOT_FOUND),
                                @ExampleObject(
                                        name = "QUESTION_NOT_FOUND",
                                        value = ErrorExamples.QUESTION_NOT_FOUND)
                            }))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "INVALID_SESSION_STATE",
                                            value = ErrorExamples.INVALID_SESSION_STATE)))
    @PostMapping("/{sessionId}/questions/{questionId}/answer-audio/upload-url")
    public UploadUrlResponse answerAudioUploadUrl(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId,
            @Parameter(description = "질문 id. `0`이면 404", example = "303") @PathVariable
                    long questionId,
            @Valid @RequestBody AnswerAudioUploadUrlRequest request) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        Stub.notFoundIfZero(questionId, ErrorCode.QUESTION_NOT_FOUND);
        return stub.read(AUDIO_UPLOAD_URL, UploadUrlResponse.class);
    }

    @Operation(
            summary = "5.7 답변 제출",
            description = "답변을 낸다. 질문마다 한 번만 낼 수 있다. 화상은 음성 인식 결과와 음성 키를, 채팅은 입력한 글을 보낸다.")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "S06 화상", value = ANSWER_VOICE),
                                @ExampleObject(name = "S06-B 채팅", value = ANSWER_TEXT)
                            }))
    @ApiResponse(
            responseCode = "202",
            content = @Content(examples = @ExampleObject(value = ANSWER_ACCEPTED)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "SESSION_NOT_FOUND",
                                        value = ErrorExamples.SESSION_NOT_FOUND),
                                @ExampleObject(
                                        name = "QUESTION_NOT_FOUND",
                                        value = ErrorExamples.QUESTION_NOT_FOUND),
                                @ExampleObject(
                                        name = "FILE_NOT_FOUND",
                                        value = ErrorExamples.FILE_NOT_FOUND)
                            }))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "ANSWER_ALREADY_SUBMITTED",
                                        value = ErrorExamples.ANSWER_ALREADY_SUBMITTED),
                                @ExampleObject(
                                        name = "INVALID_SESSION_STATE",
                                        value = ErrorExamples.INVALID_SESSION_STATE),
                                @ExampleObject(
                                        name = "IDEMPOTENCY_KEY_REUSED",
                                        value = ErrorExamples.IDEMPOTENCY_KEY_REUSED)
                            }))
    @PostMapping("/{sessionId}/questions/{questionId}/answer")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public AnswerResponse submitAnswer(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId,
            @Parameter(description = "질문 id. `0`이면 404", example = "303") @PathVariable
                    long questionId,
            @Parameter(description = IDEMPOTENCY) @RequestHeader("Idempotency-Key")
                    UUID idempotencyKey,
            @Valid @RequestBody AnswerRequest request) {
        if (request.inputType() == InputType.TEXT && request.content().length() > 1_000) {
            throw new FieldValidationException("content", "채팅 답변은 1~1,000자입니다.");
        }
        if (request.inputType() == InputType.VOICE
                && (request.audioObjectKey() == null || request.audioObjectKey().isBlank())) {
            throw new FieldValidationException("audioObjectKey", "VOICE 답변은 음성 키가 필요합니다.");
        }
        if (request.tokens() != null) {
            if (request.inputType() == InputType.TEXT) {
                throw new FieldValidationException("tokens", "TEXT 답변은 tokens를 보낼 수 없습니다.");
            }
            for (int i = 0; i < request.tokens().size(); i++) {
                TranscriptToken token = request.tokens().get(i);
                if (token.endMs() < token.startMs()) {
                    throw new FieldValidationException("tokens[" + i + "].endMs", "startMs 이상입니다.");
                }
            }
        }
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        Stub.notFoundIfZero(questionId, ErrorCode.QUESTION_NOT_FOUND);
        return stub.read(ANSWER_ACCEPTED, AnswerResponse.class);
    }

    @Operation(
            summary = "5.8 면접 끝내기",
            description = "면접을 끝낸다. 답변이 1개 이상이면 결과 분석을 시작하고(202), 없으면 결과 없이 끝난다(200).")
    @ApiResponse(
            responseCode = "202",
            content =
                    @Content(
                            schema = @Schema(implementation = SessionResponse.class),
                            examples =
                                    @ExampleObject(
                                            name = "S06-E 답변한 2개까지 → S06-1",
                                            value = ENDED_ANALYZING)))
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            schema = @Schema(implementation = SessionResponse.class),
                            examples = @ExampleObject(name = "답변 0개 → 홈", value = ENDED_ABORTED)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SESSION_NOT_FOUND",
                                            value = ErrorExamples.SESSION_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "INVALID_SESSION_STATE",
                                        value = ErrorExamples.INVALID_SESSION_STATE),
                                @ExampleObject(
                                        name = "IDEMPOTENCY_KEY_REUSED",
                                        value = ErrorExamples.IDEMPOTENCY_KEY_REUSED)
                            }))
    @PostMapping("/{sessionId}/end")
    public ResponseEntity<SessionResponse> end(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId,
            @Parameter(description = IDEMPOTENCY) @RequestHeader("Idempotency-Key")
                    UUID idempotencyKey) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return ResponseEntity.accepted().body(stub.read(ENDED_ANALYZING, SessionResponse.class));
    }

    @Operation(summary = "5.9 결과 재생성")
    @ApiResponse(
            responseCode = "202",
            content = @Content(examples = @ExampleObject(value = S06_1_ANALYZING)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SESSION_NOT_FOUND",
                                            value = ErrorExamples.SESSION_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "INVALID_SESSION_STATE",
                                            value = ErrorExamples.INVALID_SESSION_STATE)))
    @PostMapping("/{sessionId}/analysis/retry")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public SessionResponse retryAnalysis(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return stub.read(S06_1_ANALYZING, SessionResponse.class);
    }

    @Operation(
            summary = "5.10 실시간 음성 인식 토큰",
            description = "브라우저가 Soniox 실시간 음성 인식에 직접 연결할 때 쓰는 1회용 임시 키를 준다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = STT_TOKEN)))
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "VALIDATION_FAILED",
                                            value = ErrorExamples.VALIDATION_FAILED)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "SESSION_NOT_FOUND",
                                            value = ErrorExamples.SESSION_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "INVALID_SESSION_STATE",
                                            value = ErrorExamples.INVALID_SESSION_STATE)))
    @ApiResponse(
            responseCode = "503",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "STT_UNAVAILABLE",
                                            value = ErrorExamples.STT_UNAVAILABLE)))
    @PostMapping("/{sessionId}/stt-token")
    public SttTokenResponse sttToken(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId,
            @Parameter(description = "Soniox API 키. 목 서버에서만 받으며, 실제 백엔드는 서버에 둔 키를 쓴다")
                    @RequestHeader("X-Soniox-Api-Key")
                    String sonioxApiKey) {
        if (sonioxApiKey.isBlank()) {
            throw new FieldValidationException("X-Soniox-Api-Key", "필수 값입니다.");
        }
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return soniox.issueTemporaryKey(sonioxApiKey, sessionId);
    }

    @Operation(
            summary = "5.11 면접관 리액션",
            description =
                    "답변하는 도중 화면이 답변 글을 보내면 면접관 리액션을 돌려준다."
                            + " 화상은 문장이 끝날 때마다 그 문장을, 채팅은 입력이 잠깐 멈출 때마다 입력 칸의 글을 보낸다."
                            + " 보낸 글은 저장하지 않으며, 저장되는 답변은 5.7로 낸 전체 글이다.")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "S06 화상", value = REACTION_REQUEST),
                                @ExampleObject(name = "S06-B 채팅", value = REACTION_REQUEST_CHAT)
                            }))
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "리액션 있음 (끄덕임)", value = REACTION_NOD),
                                @ExampleObject(name = "리액션 없음", value = REACTION_NONE),
                                @ExampleObject(name = "말 끊기", value = REACTION_INTERRUPT)
                            }))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "SESSION_NOT_FOUND",
                                        value = ErrorExamples.SESSION_NOT_FOUND),
                                @ExampleObject(
                                        name = "QUESTION_NOT_FOUND",
                                        value = ErrorExamples.QUESTION_NOT_FOUND)
                            }))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "INVALID_SESSION_STATE",
                                        value = ErrorExamples.INVALID_SESSION_STATE),
                                @ExampleObject(
                                        name = "ANSWER_ALREADY_SUBMITTED",
                                        value = ErrorExamples.ANSWER_ALREADY_SUBMITTED)
                            }))
    @PostMapping("/{sessionId}/questions/{questionId}/reactions")
    public ReactionResponse reaction(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId,
            @Parameter(description = "질문 id. `0`이면 404", example = "303") @PathVariable
                    long questionId,
            @Valid @RequestBody ReactionRequest request) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        Stub.notFoundIfZero(questionId, ErrorCode.QUESTION_NOT_FOUND);
        return stub.read(REACTION_NOD, ReactionResponse.class);
    }

    @Operation(
            summary = "5.12 질문 음성 토큰",
            description = "브라우저가 ElevenLabs에 직접 연결해 질문 음성을 받을 때 쓰는 1회용 토큰을 준다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = TTS_TOKEN)))
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "VALIDATION_FAILED",
                                            value = ErrorExamples.VALIDATION_FAILED)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "SESSION_NOT_FOUND",
                                        value = ErrorExamples.SESSION_NOT_FOUND),
                                @ExampleObject(
                                        name = "QUESTION_NOT_FOUND",
                                        value = ErrorExamples.QUESTION_NOT_FOUND)
                            }))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "INVALID_SESSION_STATE",
                                            value = ErrorExamples.INVALID_SESSION_STATE)))
    @ApiResponse(
            responseCode = "503",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "TTS_UNAVAILABLE",
                                            value = ErrorExamples.TTS_UNAVAILABLE)))
    @PostMapping("/{sessionId}/questions/{questionId}/tts-token")
    public TtsTokenResponse ttsToken(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId,
            @Parameter(description = "질문 id. `0`이면 404", example = "303") @PathVariable
                    long questionId,
            @Parameter(description = "ElevenLabs API 키. 목 서버에서만 받으며, 실제 백엔드는 서버에 둔 키를 쓴다")
                    @RequestHeader("X-ElevenLabs-Api-Key")
                    String elevenLabsApiKey) {
        if (elevenLabsApiKey.isBlank()) {
            throw new FieldValidationException("X-ElevenLabs-Api-Key", "필수 값입니다.");
        }
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        Stub.notFoundIfZero(questionId, ErrorCode.QUESTION_NOT_FOUND);
        return elevenLabs.issueToken(elevenLabsApiKey);
    }
}
