package com.ssafy.a301.interview;

import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.interview.InterviewDtos.AnswerRequest;
import com.ssafy.a301.interview.InterviewDtos.AnswerResponse;
import com.ssafy.a301.interview.InterviewDtos.InputType;
import com.ssafy.a301.interview.InterviewDtos.QuestionResponse;
import com.ssafy.a301.interview.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.InterviewDtos.SessionCreateRequest;
import com.ssafy.a301.interview.InterviewDtos.SessionEndRequest;
import com.ssafy.a301.interview.InterviewDtos.SessionResponse;
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
              "startedAt": null, "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null, "room": null, "group": null }\
            """;
    private static final String S05_GENERATING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "READY",
              "planStatus": "GENERATING", "planProgress": 78, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 0,
              "startedAt": null, "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null, "room": null, "group": null }\
            """;
    private static final String S05_PLAN_FAILED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "READY",
              "planStatus": "FAILED", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 0,
              "startedAt": null, "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null, "room": null, "group": null }\
            """;
    private static final String STARTED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "IN_PROGRESS",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 0,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null,
              "room": { "url": "wss://rtc.hangguet.co.kr", "token": "eyJhbGciOiJIUzI1NiJ9…", "expiresAt": "2026-10-15T12:10:00+09:00" }, "group": null }\
            """;
    private static final String ROOM =
            """
            { "url": "wss://rtc.hangguet.co.kr", "token": "eyJhbGciOiJIUzI1NiJ9…", "expiresAt": "2026-10-15T12:18:42+09:00" }\
            """;
    private static final String S06_IN_PROGRESS =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "IN_PROGRESS",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": { "id": 303, "seq": 3, "content": "가장 큰 기술적 문제는 무엇이었나요?" },
              "answeredCount": 2, "elapsedSeconds": 522,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null, "room": null, "group": null }\
            """;
    private static final String S06_NEXT_GENERATING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "IN_PROGRESS",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 3, "elapsedSeconds": 640,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": null, "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null, "room": null, "group": null }\
            """;
    private static final String S06_1_ANALYZING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "ANALYZING",
              "planStatus": "READY", "planProgress": null, "analysisStep": "SCORING",
              "currentQuestion": null, "answeredCount": 5, "elapsedSeconds": 1080,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:18:00+09:00", "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null, "room": null, "group": null }\
            """;
    private static final String S06_1_FAILED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "FAILED",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 5, "elapsedSeconds": 1080,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:18:00+09:00", "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": null, "room": null, "group": null }\
            """;
    private static final String ENDED_ANALYZING =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "ANALYZING",
              "planStatus": "READY", "planProgress": null, "analysisStep": "ORGANIZING_ANSWERS",
              "currentQuestion": null, "answeredCount": 2, "elapsedSeconds": 522,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:08:42+09:00", "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": true, "room": null, "group": null }\
            """;
    private static final String ENDED_ABORTED =
            """
            { "id": 55, "applicationId": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "persona": "DEVIL", "mode": "VIDEO", "status": "ABORTED",
              "planStatus": "READY", "planProgress": null, "analysisStep": null,
              "currentQuestion": null, "answeredCount": 0, "elapsedSeconds": 95,
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:01:35+09:00", "createdAt": "2026-10-15T11:58:30+09:00", "leveledUp": false, "room": null, "group": null }\
            """;
    private static final String QUESTION =
            """
            { "id": 303, "seq": 3, "content": "흐음~ ○○ 프로젝트라. 거기서 '직접' 한 부분만 쏙 골라서 말해볼래요?",
              "createdAt": "2026-10-15T12:06:12+09:00" }\
            """;
    private static final String ANSWER_TEXT =
            """
            { "inputType": "TEXT", "content": "캐시 무효화 시점을 직접 설계했습니다." }\
            """;
    private static final String ANSWER_ACCEPTED =
            """
            { "id": 903, "questionId": 303, "inputType": "TEXT", "createdAt": "2026-10-15T12:08:40+09:00", "isLastQuestion": false }\
            """;

    private final Stub stub;

    public InterviewSessionController(Stub stub) {
        this.stub = stub;
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
            description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서 · 지운 지원서",
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
                                        name = "S06 에이전트가 다음 질문을 내기 전",
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

    @Operation(
            summary = "5.4 면접 시작",
            description =
                    "면접을 시작하고 면접방(LiveKit)을 연다. 응답 room으로 면접방에 접속한다. 질문은 AI 에이전트가 면접방 메시지"
                        + " question으로 내므로 currentQuestion은 null이다. 채팅도 면접방에 들어간다(송출 없이 수신·메시지만).")
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
    @ApiResponse(
            responseCode = "503",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "ROOM_UNAVAILABLE",
                                        value = ErrorExamples.ROOM_UNAVAILABLE),
                                @ExampleObject(
                                        name = "INTERVIEW_CAPACITY_FULL",
                                        value = ErrorExamples.INTERVIEW_CAPACITY_FULL)
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
                    "새로고침·재접속 때 지금 답할 질문을 준다. 에이전트가 다음 질문을 아직 내지 않았으면(시작 직후 포함) 202를"
                            + " 준다. 다음 질문은 면접방 메시지 question으로 온다.")
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
                                            name = "에이전트가 질문을 내기 전",
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
            summary = "5.7 답변 제출(채팅)",
            description =
                    "채팅 면접의 답변 글을 낸다. 질문마다 한 번만 낼 수 있다. 화상 답변은 AI 에이전트가 면접방에서 듣고 저장하므로 이 API를"
                            + " 쓰지 않는다(inputType VOICE는 400).")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(
            content = @Content(examples = @ExampleObject(name = "S06-B 채팅", value = ANSWER_TEXT)))
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
                                        value = ErrorExamples.QUESTION_NOT_FOUND)
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
        if (request.inputType() != InputType.TEXT) {
            throw new FieldValidationException("inputType", "채팅 답변(TEXT)만 낼 수 있습니다.");
        }
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        Stub.notFoundIfZero(questionId, ErrorCode.QUESTION_NOT_FOUND);
        return stub.read(ANSWER_ACCEPTED, AnswerResponse.class);
    }

    @Operation(
            summary = "5.8 면접 끝내기",
            description =
                    "면접을 끝낸다. 답변이 1개 이상이면 결과 분석을 시작하고(202), 없으면 결과 없이 끝난다(200). 본문은 선택이며,"
                            + " 화상 면접이면 브라우저가 잰 시선 비율(gazeRatio)을 함께 보낸다. 같은 멱등 키로 다시 보낼 때는 처음과 같은"
                            + " 값을 보낸다.")
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
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "VALIDATION_FAILED: gazeRatio가 0~100이 아님",
                                            value = ErrorExamples.GAZE_RATIO_INVALID)))
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
                    UUID idempotencyKey,
            @Valid @RequestBody(required = false) SessionEndRequest request) {
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
            summary = "5.14 면접방 입장 토큰",
            description =
                    "새로고침·연결 끊김·토큰 만료 뒤 면접방에 다시 들어갈 입장 정보를 준다. 처음 접속은 5.4 응답의 room을 쓴다."
                            + " 토큰은 10분 동안 쓸 수 있고, 접속 중에는 만료돼도 끊기지 않는다.")
    @ApiResponse(responseCode = "200", content = @Content(examples = @ExampleObject(value = ROOM)))
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
    @PostMapping("/{sessionId}/room-token")
    public RoomResponse roomToken(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return stub.read(ROOM, RoomResponse.class);
    }
}
