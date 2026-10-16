package com.ssafy.a301.result;

import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.result.ResultDtos.RecordingCreateRequest;
import com.ssafy.a301.result.ResultDtos.RecordingResponse;
import com.ssafy.a301.result.ResultDtos.RecordingUploadUrlRequest;
import com.ssafy.a301.result.ResultDtos.ReplayResponse;
import com.ssafy.a301.result.ResultDtos.ResultResponse;
import com.ssafy.a301.user.UserDtos.UploadUrlResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "6. 녹화 · 결과 · 다시보기")
@RestController
@RequestMapping("/api/v1/interview-sessions/{sessionId}")
public class ResultController {

    private static final String SESSION_ID = "면접 id. `0`이면 404(뼈대 서버)";

    private static final String UPLOAD_URL =
            """
            { "uploadUrl": "https://…s3…?X-Amz-Signature=…", "objectKey": "sessions/55/session.webm",
              "expiresAt": "2026-10-15T12:48:00+09:00" }\
            """;
    private static final String RECORDING =
            """
            { "id": 77, "recordingType": "SESSION_VIDEO", "createdAt": "2026-10-15T12:18:30+09:00" }\
            """;
    private static final String RESULT =
            """
            { "id": 55, "persona": "DEVIL", "mode": "VIDEO", "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "summary": "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
              "startedAt": "2026-10-15T12:00:00+09:00", "endedAt": "2026-10-15T12:18:00+09:00",
              "sessionScores": [
                { "criterion": "JOB_FIT", "score": 82, "grade": "GOOD", "comment": "직무 경험을 수치로 설명했어요" },
                { "criterion": "COVER_LETTER", "score": 58, "grade": "WEAK", "comment": "꼬리 질문엔 근거부터 짧게" },
                { "criterion": "LOGIC", "score": 80, "grade": "GOOD", "comment": "결론부터 말했어요" },
                { "criterion": "DELIVERY", "score": 70, "grade": "NORMAL", "comment": "말 끊김이 줄었어요" } ],
              "answers": [
                { "questionId": 301, "seq": 1, "question": "1분 자기소개", "content": "안녕하세요, 저는…", "score": 84, "grade": "GOOD",
                  "goodPoint": "핵심 경험을 1분 안에 정리했어요", "improvePoint": "지원 동기가 마지막에 짧게만 나왔어요" },
                { "questionId": 302, "seq": 2, "question": "○○ 프로젝트에서 맡은 역할은?", "content": "저는 백엔드를 맡아…", "score": 85, "grade": "GOOD",
                  "goodPoint": "역할과 기여를 수치로 구체적으로 설명했어요", "improvePoint": "꼬리 질문에서 근거 없이 답이 길어졌어요" },
                { "questionId": 303, "seq": 3, "question": "가장 큰 기술적 문제는?", "content": "캐시 일관성 문제였고…", "score": 68, "grade": "NORMAL",
                  "goodPoint": "문제 상황을 명확히 설명했어요", "improvePoint": "해결 방법을 고른 이유가 빠졌어요" },
                { "questionId": 304, "seq": 4, "question": "백엔드 직무에 지원한 이유는?", "content": "음… 서버 쪽이…", "score": 52, "grade": "WEAK",
                  "goodPoint": null, "improvePoint": "자소서 내용과 연결하지 못했어요" },
                { "questionId": 305, "seq": 5, "question": "대용량 트래픽 처리 방법은?", "content": "읽기 부하는 캐시로…", "score": 81, "grade": "GOOD",
                  "goodPoint": "단계별로 설명했어요", "improvePoint": "실제 수치 예시가 있으면 좋아요" } ],
              "speechMetrics": { "fillerPerMin": 2.1, "longPauseCount": 3, "speedDeviationPct": 8.5, "trailingOffRatio": 12.0, "pitchRangeSt": 6.2, "gazeRatio": 71.5 } }\
            """;
    private static final String REPLAY =
            """
            { "id": 55, "persona": "DEVIL", "mode": "VIDEO", "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "startedAt": "2026-10-15T12:00:00+09:00", "videoUrl": "https://…s3…/sessions/55/session.webm?X-Amz-Signature=…",
              "items": [
                { "questionId": 301, "seq": 1, "question": "1분 자기소개", "questionCreatedAt": "2026-10-15T12:00:42+09:00",
                  "answer": "안녕하세요, 저는…", "answerCreatedAt": "2026-10-15T12:02:40+09:00", "grade": "GOOD" },
                { "questionId": 302, "seq": 2, "question": "○○ 프로젝트에서 맡은 역할은?", "questionCreatedAt": "2026-10-15T12:03:10+09:00",
                  "answer": "저는 백엔드를 맡아…", "answerCreatedAt": "2026-10-15T12:05:50+09:00", "grade": "GOOD" },
                { "questionId": 303, "seq": 3, "question": "가장 큰 기술적 문제는?", "questionCreatedAt": "2026-10-15T12:06:12+09:00",
                  "answer": "저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…", "answerCreatedAt": "2026-10-15T12:09:40+09:00", "grade": "NORMAL" },
                { "questionId": 304, "seq": 4, "question": "백엔드 직무에 지원한 이유는?", "questionCreatedAt": "2026-10-15T12:10:05+09:00",
                  "answer": "음… 서버 쪽이…", "answerCreatedAt": "2026-10-15T12:13:50+09:00", "grade": "WEAK" },
                { "questionId": 305, "seq": 5, "question": "대용량 트래픽 처리 방법은?", "questionCreatedAt": "2026-10-15T12:14:30+09:00",
                  "answer": "읽기 부하는 캐시로…", "answerCreatedAt": "2026-10-15T12:17:40+09:00", "grade": "GOOD" } ] }\
            """;

    private final Stub stub;

    public ResultController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "6.1 녹화 업로드 주소",
            description =
                    """
                    **화면 — S06 화상 › 면접 종료 시**

                    녹화 동의는 가입 때 받는다(1.2 `RECORDING`). 응답은 2.4와 같은 형식. 용량이 크면 멀티파트 업로드로 바뀔 수 있다(BE 결정).

                    - **200**: 발급
                    - **404 / SESSION_NOT_FOUND**
                    - **409 / INVALID_SESSION_STATE**: 화상 면접이 아니거나 시작 전\
                    """)
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = UPLOAD_URL)))
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
    @PostMapping("/recordings/upload-url")
    public UploadUrlResponse recordingUploadUrl(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId,
            @Valid @RequestBody RecordingUploadUrlRequest request) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return stub.read(UPLOAD_URL, UploadUrlResponse.class);
    }

    @Operation(
            summary = "6.2 녹화 등록",
            description =
                    """
                    **화면 — S06 녹화 업로드 완료 직후**

                    등록된 영상으로 시선 응시 비율(6.3 `speechMetrics.gazeRatio`)을 구한다.

                    - **201**: 등록
                    - **404 / FILE_NOT_FOUND**: S3에 파일 없음
                    - **409 / RECORDING_ALREADY_EXISTS**: 이 면접에 녹화가 이미 있음(면접당 1개, 서버에서 확인)\
                    """)
    @ApiResponse(
            responseCode = "201",
            content = @Content(examples = @ExampleObject(value = RECORDING)))
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
                                        name = "FILE_NOT_FOUND",
                                        value = ErrorExamples.FILE_NOT_FOUND)
                            }))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "RECORDING_ALREADY_EXISTS",
                                            value = ErrorExamples.RECORDING_ALREADY_EXISTS)))
    @PostMapping("/recordings")
    @ResponseStatus(HttpStatus.CREATED)
    public RecordingResponse registerRecording(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId,
            @Valid @RequestBody RecordingCreateRequest request) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return stub.read(RECORDING, RecordingResponse.class);
    }

    @Operation(
            summary = "6.3 면접 결과",
            description =
                    """
                    **화면 — S07 피드백 결과**

                    면접 1회 결과. 화면은 점수 대신 좋아요·보통·아쉬워요로 보여 준다. 반응 썸네일은 면접관별 고정 이미지라 API 필드가 없다. 채팅 면접은 같은 형식에 `mode: CHAT`, `speechMetrics: null`. 채팅도 기준 4개 점수가 모두 나온다(전달력은 답변 글로 판단).

                    화면 표시: 기준 이름(`JOB_FIT` → 직무 적합성, `COVER_LETTER` → 자소서 검증, `LOGIC` → 논리성, `DELIVERY` → 전달력)과 `grade` 문구는 화면이 바꾼다. 질문별 피드백은 첫 번째 `WEAK`·`NORMAL` 질문만 펼친다.

                    - **200**: `COMPLETED`
                    - **404 / SESSION_NOT_FOUND**
                    - **409 / RESULT_NOT_READY**: `ANALYZING` 또는 `FAILED`. 화면은 S06-1로
                    - **409 / NO_RESULT**: `ABORTED`\
                    """)
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(name = "S07 화상 면접 결과", value = RESULT)))
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
                                        name = "RESULT_NOT_READY",
                                        value = ErrorExamples.RESULT_NOT_READY),
                                @ExampleObject(name = "NO_RESULT", value = ErrorExamples.NO_RESULT)
                            }))
    @GetMapping("/result")
    public ResultResponse result(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return stub.read(RESULT, ResultResponse.class);
    }

    @Operation(
            summary = "6.4 다시보기",
            description =
                    """
                    **화면 — S07-1 면접 다시보기**

                    화상은 녹화 영상과 질문별 시점(마커), 채팅은 같은 목록을 대화 기록으로 준다(`mode: CHAT`, `videoUrl: null`). 재생 중 자막은 재생 위치가 속한 질문(`questionCreatedAt` ≤ 위치 < 다음 질문)의 `answer`.

                    - **200**: `COMPLETED`
                    - **404 / SESSION_NOT_FOUND**
                    - **409 / RESULT_NOT_READY** · **NO_RESULT**: 6.3과 같음\
                    """)
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples =
                                    @ExampleObject(
                                            name =
                                                    "S07-1 화상(마커 00:42 · 03:10 · 06:12 · 10:05 ·"
                                                            + " 14:30)",
                                            value = REPLAY)))
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
                                        name = "RESULT_NOT_READY",
                                        value = ErrorExamples.RESULT_NOT_READY),
                                @ExampleObject(name = "NO_RESULT", value = ErrorExamples.NO_RESULT)
                            }))
    @GetMapping("/replay")
    public ReplayResponse replay(
            @Parameter(description = SESSION_ID, example = "55") @PathVariable long sessionId) {
        Stub.notFoundIfZero(sessionId, ErrorCode.SESSION_NOT_FOUND);
        return stub.read(REPLAY, ReplayResponse.class);
    }
}
