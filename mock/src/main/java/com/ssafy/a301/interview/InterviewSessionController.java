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
import com.ssafy.a301.interview.InterviewDtos.SessionCreateRequest;
import com.ssafy.a301.interview.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.InterviewDtos.SttTokenResponse;
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

@Tag(
        name = "5. 면접 진행",
        description =
                """
                **면접 상태** `READY` → (시작) `IN_PROGRESS` → (끝내기, 답변 ≥1) `ANALYZING` → `COMPLETED` / `FAILED`(결과 재생성으로 `ANALYZING`). 답변 0개로 끝내면 `ABORTED`.

                **면접 플랜 상태** `planStatus`: `GENERATING` · `READY` · `FAILED`. **분석 단계** `analysisStep`: `ORGANIZING_ANSWERS` → `SCORING` → `WRITING_FEEDBACK`.\
                """)
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
              "startedAt": null, "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00" }\
            """;
    private static final String S05_GENERATING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "READY",
              "planStatus": "GENERATING", "planProgress": 78, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 0,
              "startedAt": null, "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00" }\
            """;
    private static final String S05_PLAN_FAILED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "READY",
              "planStatus": "FAILED", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 0,
              "startedAt": null, "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00" }\
            """;
    private static final String STARTED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "IN_PROGRESS",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": { "id": 301, "seq": 1, "content": "1분 동안 자기소개 부탁드려요." },
              "answeredCount": 0, "elapsedSeconds": 0,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00" }\
            """;
    private static final String S06_IN_PROGRESS =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "IN_PROGRESS",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": { "id": 303, "seq": 3, "content": "가장 큰 기술적 문제는 무엇이었나요?" },
              "answeredCount": 2, "elapsedSeconds": 522,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00" }\
            """;
    private static final String S06_NEXT_GENERATING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "IN_PROGRESS",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 3, "elapsedSeconds": 640,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00" }\
            """;
    private static final String S06_1_ANALYZING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "ANALYZING",
              "planStatus": "READY", "planProgress": null, "analysisStep": "SCORING",
              "currentQuestion": null, "answeredCount": 5, "elapsedSeconds": 1080,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:18:00+09:00", "createdAt": "2026-10-15T11:58:30+09:00" }\
            """;
    private static final String S06_1_FAILED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "FAILED",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 5, "elapsedSeconds": 1080,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:18:00+09:00", "createdAt": "2026-10-15T11:58:30+09:00" }\
            """;
    private static final String ENDED_ANALYZING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "ANALYZING",
              "planStatus": "READY", "planProgress": null, "analysisStep": "ORGANIZING_ANSWERS",
              "currentQuestion": null, "answeredCount": 2, "elapsedSeconds": 522,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:08:42+09:00", "createdAt": "2026-10-15T11:58:30+09:00" }\
            """;
    private static final String ENDED_ABORTED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "ABORTED",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 95,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:01:35+09:00", "createdAt": "2026-10-15T11:58:30+09:00" }\
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
            { "inputType": "VOICE", "content": "저는 그 프로젝트에서 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고, 조회 응답 시간을 40% 줄였습니다.",
              "audioObjectKey": "sessions/55/answers/303.webm" }\
            """;
    private static final String ANSWER_TEXT =
            """
            { "inputType": "TEXT", "content": "캐시 무효화 시점을 직접 설계했습니다." }\
            """;
    private static final String ANSWER_ACCEPTED =
            """
            { "id": 903, "questionId": 303, "inputType": "VOICE", "createdAt": "2026-10-15T12:08:40+09:00", "isLastQuestion": false }\
            """;
    private static final String STT_TOKEN =
            """
            { "token": "…", "expiresAt": "2026-10-15T12:16:00+09:00" }\
            """;

    private final Stub stub;

    public InterviewSessionController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "5.1 면접 만들기",
            description =
                    """
                    **화면 — S05-1 면접 방식 › [다음: 장치 점검](화상) · [면접 시작](채팅)**

                    면접을 만들고 면접 플랜(질문·평가 기준) 생성을 시작한다(사용자에게 비노출). 완료는 WebSocket `PLAN_READY` 또는 5.2로 확인한다.

                    - **201**: 생성(`status: READY`, `planStatus: GENERATING`)
                    - **404 / APPLICATION_NOT_FOUND**: 없거나 남의 지원서
                    - **409 / IDEMPOTENCY_KEY_REUSED**: 같은 키로 다른 본문\
                    """)
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
            description =
                    """
                    **화면 — S05 [면접 시작] 활성화, S06·S06-B 상단, S06-F 재연결 복구, S06-1 진행**

                    WebSocket을 놓쳤거나 새로고침했을 때 이 응답으로 화면을 다시 그린다(CONTRIBUTING 7). "질문 3 / 5"의 전체 질문 수는 아직 정해지지 않았다(B-3).

                    - **200**: 본인 면접
                    - **404 / SESSION_NOT_FOUND**: 없거나 남의 면접\
                    """)
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

    @Operation(
            summary = "5.3 면접 플랜 재생성",
            description =
                    """
                    **화면 — S05 장치 점검 › 생성 실패 › [다시 시도]**

                    - **202**: 재생성 시작. 5.2 형식(`planStatus: GENERATING`)
                    - **404 / SESSION_NOT_FOUND**
                    - **409 / PLAN_NOT_FAILED**: `planStatus`가 `FAILED`가 아님\
                    """)
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

    @Operation(
            summary = "5.4 면접 시작",
            description =
                    """
                    **화면 — S05 [면접 시작](화상), S05-1 [면접 시작](채팅)**

                    면접을 시작하고 첫 질문을 준다. 화상은 이 응답 시점에 녹화를 시작한다(6.4 질문 시점의 기준).

                    채팅은 장치 점검 없이 5.1 직후 S06-B로 바로 넘어간다. 면접관을 띄워 둔 채 `PLAN_READY`(또는 5.2 `planStatus: READY`)를 받으면 화면이 이 API를 자동으로 부른다. 별도 대기 화면은 없다.

                    - **200**: 시작. 5.2 형식(`status: IN_PROGRESS`, `currentQuestion` = 1번 질문)
                    - **404 / SESSION_NOT_FOUND**
                    - **409 / PLAN_NOT_READY**: 플랜 생성 중이거나 실패
                    - **409 / INVALID_SESSION_STATE**: `READY`가 아님\
                    """)
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
            description =
                    """
                    **화면 — S06·S06-B 질문 말풍선. `QUESTION_READY`를 놓쳤을 때 복구**

                    - **200**: 답할 질문 있음
                    - **202 / QUESTION_GENERATING**: 다음 질문 생성 중. 오류가 아니라 본문은 `{ "code": "QUESTION_GENERATING" }`만. `QUESTION_READY`를 기다린다
                    - **404 / SESSION_NOT_FOUND**
                    - **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님

                    질문 음성(TTS) 전달은 보류(B-1).\
                    """)
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
            description =
                    """
                    **화면 — S06 화상 › 답변 녹음 시작**

                    응답은 2.4와 같은 형식. `objectKey`는 5.7 `audioObjectKey`로 보낸다.

                    - **200**: 발급
                    - **404 / SESSION_NOT_FOUND** · **QUESTION_NOT_FOUND**
                    - **409 / INVALID_SESSION_STATE**: 화상 면접 중이 아님\
                    """)
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
            description =
                    """
                    **화면 — S06 [답변 완료] 또는 침묵, S06-B [보내기]**

                    질문 하나에 답변 하나만 낼 수 있다. 화상은 실시간 음성 인식(5.10)의 최종 글과 음성 키를, 채팅은 입력한 글을 보낸다. 음성 파일은 음성 지표 분석·보관용이다. 다음 질문은 `QUESTION_READY` 또는 5.5로 받고, 점수·피드백은 면접 종료 후 채워진다.

                    - **202**: 접수
                    - **400 / VALIDATION_FAILED**: `content` 길이 초과(TEXT 1,000자 / VOICE 10,000자), VOICE인데 `audioObjectKey` 없음
                    - **404 / SESSION_NOT_FOUND** · **QUESTION_NOT_FOUND** · **FILE_NOT_FOUND**(음성 파일 없음)
                    - **409 / ANSWER_ALREADY_SUBMITTED**: 이미 답변함(다른 키로 재전송)
                    - **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님\
                    """)
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
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        Stub.notFoundIfZero(questionId, ErrorCode.QUESTION_NOT_FOUND);
        return stub.read(ANSWER_ACCEPTED, AnswerResponse.class);
    }

    @Operation(
            summary = "5.8 면접 끝내기",
            description =
                    """
                    **화면 — 마지막 답변 후 자동, S06-E [끝내기], S06-F [면접 끝내기]**

                    본문 없음. 답변 1개 이상이면 결과 생성을 시작하고 그날 연습으로 인정한다. 0개면 결과·연습 인정 없이 끝난다.

                    - **202**: 답변 ≥1. 5.2 형식(`status: ANALYZING`). 완료는 `SESSION_STATUS_CHANGED` 또는 5.2
                    - **200**: 답변 0. 5.2 형식(`status: ABORTED`). 화면은 홈으로
                    - **404 / SESSION_NOT_FOUND**
                    - **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님\
                    """)
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

    @Operation(
            summary = "5.9 결과 재생성",
            description =
                    """
                    **화면 — S06-1 › 실패 › [다시 시도]**

                    - **202**: 재생성 시작. 5.2 형식(`status: ANALYZING`)
                    - **404 / SESSION_NOT_FOUND**
                    - **409 / INVALID_SESSION_STATE**: `FAILED`가 아님\
                    """)
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
            description =
                    """
                    **화면 — S06 화상 › 답변 듣기 시작, 토큰 만료 전 재발급**

                    브라우저가 STT 회사에 직접 스트리밍 연결할 1회용 임시 토큰을 준다. API 키는 서버에만 두고, 음성은 BE·WebSocket을 거치지 않는다(CONTRIBUTING 7). 화면은 받아 적는 글을 S06 자막으로 보여 주고 최종 글을 5.7 `content`로 보낸다. STT 회사는 1회용 토큰을 지원하는 일레븐랩스·Soniox 중 미정(B-2).

                    - **200**: 발급
                    - **404 / SESSION_NOT_FOUND**
                    - **409 / INVALID_SESSION_STATE**: 화상 면접 중이 아님
                    - **503 / STT_UNAVAILABLE**: STT 회사 토큰 발급 실패. 잠시 뒤 재시도\
                    """)
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = STT_TOKEN)))
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
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return stub.read(STT_TOKEN, SttTokenResponse.class);
    }
}
