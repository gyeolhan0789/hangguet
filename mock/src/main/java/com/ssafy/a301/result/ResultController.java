package com.ssafy.a301.result;

import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.result.ResultDtos.ReplayResponse;
import com.ssafy.a301.result.ResultDtos.ResultResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "6. 결과 · 다시보기")
@RestController
@RequestMapping("/api/v1/interview-sessions/{sessionId}")
public class ResultController {

    private static final String SESSION_ID = "면접 id. `0`이면 404(뼈대 서버)";

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
              "speechMetrics": { "fillerPerMin": 2.1, "longPauseCount": 3, "speedDeviationPct": 8.5, "trailingOffRatio": 12.0, "pitchRangeSt": 6.2, "gazeRatio": 72.5 } }\
            """;
    private static final String REPLAY =
            """
            { "id": 55, "persona": "DEVIL", "mode": "VIDEO", "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "startedAt": "2026-10-15T12:00:00+09:00", "videoStatus": "READY",
              "videoUrl": "https://…s3…/recordings/55.mp4?X-Amz-Signature=…",
              "items": [
                { "questionId": 301, "seq": 1, "question": "1분 자기소개", "questionCreatedAt": "2026-10-15T12:00:42+09:00",
                  "answer": "안녕하세요, 저는…", "answerCreatedAt": "2026-10-15T12:02:40+09:00", "grade": "GOOD", "timeline": null },
                { "questionId": 302, "seq": 2, "question": "○○ 프로젝트에서 맡은 역할은?", "questionCreatedAt": "2026-10-15T12:03:10+09:00",
                  "answer": "저는 백엔드를 맡아…", "answerCreatedAt": "2026-10-15T12:05:50+09:00", "grade": "GOOD", "timeline": null },
                { "questionId": 303, "seq": 3, "question": "가장 큰 기술적 문제는?", "questionCreatedAt": "2026-10-15T12:06:12+09:00",
                  "answer": "저는 그때 캐시 일관성 문제를 해결하려고 TTL 전략을 바꿨고…", "answerCreatedAt": "2026-10-15T12:09:40+09:00", "grade": "NORMAL", "timeline": null },
                { "questionId": 304, "seq": 4, "question": "백엔드 직무에 지원한 이유는?", "questionCreatedAt": "2026-10-15T12:10:05+09:00",
                  "answer": "음… 서버 쪽이…", "answerCreatedAt": "2026-10-15T12:13:50+09:00", "grade": "WEAK",
                  "timeline": {
                    "points": [ { "at": 620.25, "value": 0.4 }, { "at": 621.25, "value": -0.6 }, { "at": 622.25, "value": -1.7 },
                                { "at": 623.25, "value": -2.1 }, { "at": 624.25, "value": -1.2 }, { "at": 625.25, "value": 0.3 } ],
                    "checkpoints": [ { "at": 623.25, "start": 622.25, "end": 623.25, "value": -2.1,
                      "reasons": [ { "metric": "CONFIDENCE", "count": null, "text": "고개가 숙여졌어요. 화면 속 면접관을 보며 말해 보세요." },
                                   { "metric": "FILLER", "count": 3, "text": "'음'이 이어졌어요. 생각할 때는 소리 없이 잠깐 멈춰도 괜찮아요." } ] } ] } },
                { "questionId": 305, "seq": 5, "question": "대용량 트래픽 처리 방법은?", "questionCreatedAt": "2026-10-15T12:14:30+09:00",
                  "answer": "읽기 부하는 캐시로…", "answerCreatedAt": "2026-10-15T12:17:40+09:00", "grade": "GOOD", "timeline": null } ] }\
            """;

    private final Stub stub;

    public ResultController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "6.3 면접 결과",
            description = "면접 한 번의 결과를 준다. 채팅 면접은 `speechMetrics`가 null이다.")
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
            description = "다시보기 정보를 준다. 화상은 녹화 영상과 질문별 시점을, 채팅은 대화 기록을 준다(`videoUrl`은 null).")
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
