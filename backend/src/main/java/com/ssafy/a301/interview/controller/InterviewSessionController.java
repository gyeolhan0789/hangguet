package com.ssafy.a301.interview.controller;

import com.ssafy.a301.common.idempotency.Idempotent;
import com.ssafy.a301.common.validation.SupportedDate;
import com.ssafy.a301.common.validation.SupportedMonth;
import com.ssafy.a301.common.web.CurrentUserId;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.AnswerRequest;
import com.ssafy.a301.interview.dto.InterviewDtos.AnswerResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.PendingResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.QuestionResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionCalendarResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionCreateRequest;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionEndRequest;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionListResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.service.AnswerService;
import com.ssafy.a301.interview.service.InterviewSessionListService;
import com.ssafy.a301.interview.service.InterviewSessionService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.LocalDate;
import java.time.YearMonth;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "5. 면접 진행")
@RestController
@RequestMapping("/api/v1/interview-sessions")
public class InterviewSessionController {
    private final InterviewSessionService sessions;
    private final InterviewSessionListService sessionList;
    private final AnswerService answers;

    public InterviewSessionController(
            InterviewSessionService sessions,
            InterviewSessionListService sessionList,
            AnswerService answers) {
        this.sessions = sessions;
        this.sessionList = sessionList;
        this.answers = answers;
    }

    @Operation(
            summary = "5.7 답변 제출(채팅)",
            description =
                    "채팅 면접의 답변 글을 낸다. 질문마다 한 번만 낼 수 있다. 다음 질문은 AI 에이전트가 면접방 메시지로 알린다. 화상"
                            + " 답변은 이 API를 쓰지 않는다.")
    @ApiResponse(responseCode = "202", description = "접수")
    @ApiResponse(
            responseCode = "400",
            description = "VALIDATION_FAILED: content 1~1,000자 아님 · inputType이 TEXT가 아님(화상 면접)")
    @ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND · QUESTION_NOT_FOUND")
    @ApiResponse(
            responseCode = "409",
            description =
                    "ANSWER_ALREADY_SUBMITTED · INVALID_SESSION_STATE: IN_PROGRESS가 아님 ·"
                            + " IDEMPOTENCY_KEY_REUSED")
    @Idempotent
    @PostMapping("/{sessionId}/questions/{questionId}/answer")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public AnswerResponse submitAnswer(
            @CurrentUserId long userId,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId,
            @Parameter(description = "질문 id", example = "303") @PathVariable long questionId,
            @Valid @RequestBody AnswerRequest request) {
        return answers.submit(userId, sessionId, questionId, request);
    }

    @Operation(
            summary = "5.8 면접 끝내기",
            description =
                    "면접을 끝낸다. 답변이 1개 이상이면 결과 분석을 시작하고(202), 없으면 결과 없이 끝난다(200). 본문은 선택이며,"
                            + " 화상 면접이면 브라우저가 잰 시선 비율을 함께 보낸다.")
    @ApiResponse(
            responseCode = "202",
            description = "답변 ≥1. status ANALYZING",
            content = @Content(schema = @Schema(implementation = SessionResponse.class)))
    @ApiResponse(
            responseCode = "200",
            description = "답변 0. status ABORTED",
            content = @Content(schema = @Schema(implementation = SessionResponse.class)))
    @ApiResponse(responseCode = "400", description = "VALIDATION_FAILED: gazeRatio가 0~100이 아님")
    @ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND")
    @ApiResponse(
            responseCode = "409",
            description = "INVALID_SESSION_STATE: IN_PROGRESS가 아님 · IDEMPOTENCY_KEY_REUSED")
    @Idempotent
    @PostMapping("/{sessionId}/end")
    public ResponseEntity<SessionResponse> end(
            @CurrentUserId long userId,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId,
            @Valid @RequestBody(required = false) SessionEndRequest request) {
        SessionResponse ended =
                sessions.end(userId, sessionId, request == null ? null : request.gazeRatio());
        return ResponseEntity.status(
                        ended.status() == SessionStatus.ANALYZING
                                ? HttpStatus.ACCEPTED
                                : HttpStatus.OK)
                .body(ended);
    }

    @Operation(summary = "5.9 결과 재생성")
    @ApiResponse(responseCode = "202", description = "재생성 시작. status ANALYZING")
    @ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND")
    @ApiResponse(responseCode = "409", description = "INVALID_SESSION_STATE: FAILED가 아님")
    @PostMapping("/{sessionId}/analysis/retry")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public SessionResponse retryAnalysis(
            @CurrentUserId long userId,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId) {
        return sessions.retryAnalysis(userId, sessionId);
    }

    @Operation(summary = "5.13 연습 면접 목록", description = "선택한 한국 날짜에 시작한 본인 면접 기록을 최근 순으로 준다.")
    @ApiResponse(
            responseCode = "400",
            description = "VALIDATION_FAILED: 날짜 누락·형식 오류·0001-01-01~9999-12-31 밖, page·size 범위 오류")
    @GetMapping
    public SessionListResponse list(
            @CurrentUserId long userId,
            @Parameter(description = "연습 날짜(한국 시간, 0001-01-01~9999-12-31)", example = "2026-10-21")
                    @RequestParam
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    @SupportedDate
                    LocalDate practiceDate,
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "5")
                    @RequestParam(defaultValue = "5")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        return sessionList.list(userId, practiceDate, page, size);
    }

    @Operation(
            summary = "5.15 월별 연습 면접 횟수",
            description = "한국 시간 시작일 기준. 해당 월의 모든 날짜와 면접 횟수를 준다. 기록이 없는 날짜는 0이다.")
    @ApiResponse(responseCode = "400", description = "VALIDATION_FAILED: month 누락 또는 YYYY-MM 형식 아님")
    @GetMapping("/calendar")
    public SessionCalendarResponse calendar(
            @CurrentUserId long userId,
            @Parameter(description = "조회 월(0001-01~9999-12)", example = "2026-10")
                    @RequestParam
                    @SupportedMonth
                    String month) {
        return sessionList.calendar(userId, YearMonth.parse(month));
    }

    @Operation(summary = "5.1 면접 만들기", description = "면접을 만들고 질문 준비를 시작한다. 준비가 끝났는지는 5.2로 확인한다.")
    @ApiResponse(responseCode = "201", description = "생성(status READY, planStatus GENERATING)")
    @ApiResponse(responseCode = "404", description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서 · 지운 지원서")
    @ApiResponse(responseCode = "409", description = "IDEMPOTENCY_KEY_REUSED: 같은 키로 다른 요청")
    @Idempotent
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SessionResponse create(
            @CurrentUserId long userId, @Valid @RequestBody SessionCreateRequest request) {
        return sessions.create(userId, request);
    }

    @Operation(
            summary = "5.2 면접 조회",
            description = "면접의 현재 상태를 준다. 질문 준비와 결과 분석이 끝났는지 이 API를 2초마다(임시 값) 불러 확인한다.")
    @ApiResponse(responseCode = "200", description = "본인 면접")
    @ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND: 없거나 남의 면접")
    @GetMapping("/{sessionId}")
    public SessionResponse get(
            @CurrentUserId long userId,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId) {
        return sessions.get(userId, sessionId);
    }

    @Operation(summary = "5.3 면접 플랜 재생성")
    @ApiResponse(responseCode = "202", description = "재생성 시작(planStatus GENERATING)")
    @ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND")
    @ApiResponse(responseCode = "409", description = "PLAN_NOT_FAILED: planStatus가 FAILED가 아님")
    @PostMapping("/{sessionId}/plan/retry")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public SessionResponse retryPlan(
            @CurrentUserId long userId,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId) {
        return sessions.retryPlan(userId, sessionId);
    }

    @Operation(
            summary = "5.4 면접 시작",
            description =
                    "면접을 시작하고 면접방을 연다. 에이전트를 배정하고 화상이면 녹화를 시작한다. 질문은 에이전트가 면접방에서 낸다."
                            + " 에이전트가 배정을 거절해 START_FAILED가 되면 같은 질문으로 다시 시작한다.")
    @ApiResponse(
            responseCode = "200",
            description = "시작(status IN_PROGRESS, room = 입장 정보, currentQuestion = null)")
    @ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND")
    @ApiResponse(
            responseCode = "409",
            description =
                    "PLAN_NOT_READY: 플랜 생성 중이거나 실패 · INVALID_SESSION_STATE: READY·START_FAILED가 아님"
                            + " · IDEMPOTENCY_KEY_REUSED")
    @ApiResponse(
            responseCode = "503",
            description =
                    "ROOM_UNAVAILABLE: 면접방을 열지 못함(상태 그대로, 다시 시도) · INTERVIEW_CAPACITY_FULL: 화상"
                            + " 면접 동시 진행 상한(상태 그대로, 자동으로 다시 보내지 않음)")
    @Idempotent
    @PostMapping("/{sessionId}/start")
    public SessionResponse start(
            @CurrentUserId long userId,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId) {
        return sessions.start(userId, sessionId);
    }

    @Operation(
            summary = "5.5 지금 질문",
            description = "새로고침·재접속 때 지금 답할 질문을 준다. 에이전트가 다음 질문을 아직 내지 않았으면 202를 준다.")
    @ApiResponse(
            responseCode = "200",
            description = "답할 질문 있음",
            content = @Content(schema = @Schema(implementation = QuestionResponse.class)))
    @ApiResponse(
            responseCode = "202",
            description = "QUESTION_GENERATING: 에이전트가 다음 질문을 아직 내지 않음(오류 아님)",
            content = @Content(schema = @Schema(implementation = PendingResponse.class)))
    @ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND")
    @ApiResponse(
            responseCode = "409",
            description = "INVALID_SESSION_STATE: IN_PROGRESS가 아니거나 5개 질문에 모두 답함(5.8 호출)")
    @GetMapping("/{sessionId}/questions/current")
    public ResponseEntity<Object> currentQuestion(
            @CurrentUserId long userId,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId) {
        return sessions.currentQuestion(userId, sessionId)
                .<ResponseEntity<Object>>map(ResponseEntity::ok)
                .orElseGet(
                        () ->
                                ResponseEntity.accepted()
                                        .body(new PendingResponse("QUESTION_GENERATING")));
    }

    @Operation(
            summary = "5.14 면접방 입장 토큰",
            description = "새로고침·연결 끊김·토큰 만료 뒤 면접방에 다시 들어갈 입장 정보를 준다.")
    @ApiResponse(responseCode = "200", description = "발급")
    @ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND")
    @ApiResponse(responseCode = "409", description = "INVALID_SESSION_STATE: IN_PROGRESS가 아님")
    @PostMapping("/{sessionId}/room-token")
    public RoomResponse roomToken(
            @CurrentUserId long userId,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId) {
        return sessions.roomAccess(userId, sessionId);
    }
}
