package com.ssafy.a301.result.controller;

import com.ssafy.a301.common.web.CurrentUserId;
import com.ssafy.a301.result.dto.ResultDtos.ReplayResponse;
import com.ssafy.a301.result.dto.ResultDtos.ResultResponse;
import com.ssafy.a301.result.service.ResultService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
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
    private final ResultService results;

    public ResultController(ResultService results) {
        this.results = results;
    }

    @Operation(
            summary = "6.3 면접 결과",
            description =
                    "면접 한 번의 결과를 준다. 질문별 피드백은 답변한 질문만 질문 순으로 준다. 채팅 면접은 speechMetrics가 null이다.")
    @ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND: 없거나 남의 면접")
    @ApiResponse(
            responseCode = "409",
            description =
                    "RESULT_NOT_READY: 결과 생성 중·실패(ANALYZING·FAILED) · NO_RESULT: 답변 없이 끝남(ABORTED)")
    @GetMapping("/result")
    public ResultResponse result(
            @CurrentUserId long userId,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId) {
        return results.result(userId, sessionId);
    }

    @Operation(
            summary = "6.4 다시보기",
            description =
                    "화상은 녹화 영상 주소와 질문별 시점을, 채팅은 대화 기록을 준다(videoUrl null). 낸 질문은 답변이 없어도 넣는다."
                            + " 녹화 합치기가 끝나기 전이거나 실패했으면 화상도 videoUrl이 null이다.")
    @ApiResponse(responseCode = "404", description = "SESSION_NOT_FOUND: 없거나 남의 면접")
    @ApiResponse(
            responseCode = "409",
            description =
                    "RESULT_NOT_READY: 결과 생성 중·실패(ANALYZING·FAILED) · NO_RESULT: 답변 없이 끝남(ABORTED)")
    @GetMapping("/replay")
    public ReplayResponse replay(
            @CurrentUserId long userId,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId) {
        return results.replay(userId, sessionId);
    }
}
