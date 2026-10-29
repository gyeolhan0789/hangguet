package com.ssafy.a301.application.controller;

import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationCreateRequest;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationListItem;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationResponse;
import com.ssafy.a301.application.service.ApplicationService;
import com.ssafy.a301.common.web.CurrentUserId;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionListItem;
import com.ssafy.a301.interview.service.InterviewSessionListService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.data.web.PagedModel;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "4. 지원서")
@RestController
@RequestMapping("/api/v1/applications")
public class ApplicationController {
    private final ApplicationService service;
    private final InterviewSessionListService sessions;

    public ApplicationController(ApplicationService service, InterviewSessionListService sessions) {
        this.service = service;
        this.sessions = sessions;
    }

    @Operation(
            summary = "4.1 지원서 작성",
            description =
                    "지원서를 저장한다. 저장한 지원서는 여러 면접에 쓸 수 있다. 자기소개서는 문항 1~5개(문항 질문 1~255자, 답변"
                            + " 1~20,000자)이고 적은 순서가 문항 순서다. 저장 전에 자기소개서로 면접 질문을 만들 수 있는지 판단해, 만들 수"
                            + " 없으면 400(coverLetterItems), 판단하지 못하면 503이다.")
    @ApiResponse(responseCode = "201", description = "저장")
    @ApiResponse(
            responseCode = "400",
            description = "VALIDATION_FAILED: 형식 오류 또는 질문을 만들기 어려운 자기소개서(coverLetterItems)")
    @ApiResponse(
            responseCode = "503",
            description = "COVER_LETTER_CHECK_UNAVAILABLE: 자기소개서를 판단하지 못함")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApplicationResponse create(
            @CurrentUserId long userId, @Valid @RequestBody ApplicationCreateRequest request) {
        return service.create(userId, request);
    }

    @Operation(summary = "4.2 지원서 조회", description = "자기소개서 문항을 문항 순서대로 준다.")
    @ApiResponse(responseCode = "200", description = "본인 지원서")
    @ApiResponse(responseCode = "404", description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서 · 지운 지원서")
    @GetMapping("/{applicationId}")
    public ApplicationResponse get(
            @CurrentUserId long userId,
            @Parameter(description = "지원서 id", example = "12") @PathVariable long applicationId) {
        return service.get(userId, applicationId);
    }

    @Operation(
            summary = "4.3 지원서 목록",
            description = "최근에 작성한 순으로 준다. 지운 지원서는 빠진다. 자기소개서 문항은 빠져 있다(4.2로 조회).")
    @ApiResponse(responseCode = "200", description = "항상. 없으면 빈 목록. 범위를 넘는 페이지도 빈 목록과 실제 전체 건수")
    @GetMapping
    public PagedModel<ApplicationListItem> list(
            @CurrentUserId long userId,
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "10")
                    @RequestParam(defaultValue = "10")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        return service.list(userId, page, size);
    }

    @Operation(
            summary = "4.5 지원서 삭제",
            description =
                    "지원서를 삭제한다. 면접에 쓴 지원서도 삭제할 수 있고, 그 지원서로 본 면접 기록은 남는다. 지운 지원서는 4.2 · 4.3 · 4.6 ·"
                            + " 5.1에서 없는 지원서로 다룬다. 이미 지운 지원서는 404다.")
    @ApiResponse(responseCode = "204", description = "삭제")
    @ApiResponse(
            responseCode = "404",
            description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서 · 이미 지운 지원서")
    @DeleteMapping("/{applicationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @CurrentUserId long userId,
            @Parameter(description = "지원서 id", example = "12") @PathVariable long applicationId) {
        service.delete(userId, applicationId);
    }

    @Operation(
            summary = "4.6 지원서의 연습 면접 목록",
            description =
                    "이 지원서로 본 연습 면접을 시작 시각·id 내림차순으로 준다. 5.13과 같이 본인의 답변 1개 이상인"
                            + " ANALYZING·COMPLETED·FAILED만 포함하고, 항목 모양도 5.13과 같다.")
    @ApiResponse(responseCode = "200", description = "항상. 면접이 없으면 빈 목록. 범위를 넘는 페이지도 빈 목록과 실제 전체 건수")
    @ApiResponse(responseCode = "400", description = "VALIDATION_FAILED: 음수 페이지 · size 범위 오류")
    @ApiResponse(responseCode = "404", description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서 · 지운 지원서")
    @ApiResponse(
            responseCode = "500",
            description = "INTERNAL_ERROR: 완료 면접인데 기준별 평가 4개가 모두 저장되지 않음(5.13과 같음)")
    @GetMapping("/{applicationId}/interview-sessions")
    public PagedModel<SessionListItem> sessions(
            @CurrentUserId long userId,
            @Parameter(description = "지원서 id", example = "12") @PathVariable long applicationId,
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "10")
                    @RequestParam(defaultValue = "10")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        return sessions.listByApplication(userId, applicationId, page, size);
    }
}
