package com.ssafy.a301.application.controller;

import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationCreateRequest;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationListItem;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationResponse;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationUpdateRequest;
import com.ssafy.a301.application.service.ApplicationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.data.web.PagedModel;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
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

    public ApplicationController(ApplicationService service) {
        this.service = service;
    }

    @Operation(summary = "4.1 지원서 작성", description = "지원서를 저장한다. 저장한 지원서는 여러 면접에 쓸 수 있다.")
    @ApiResponse(responseCode = "201", description = "저장")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApplicationResponse create(
            @AuthenticationPrincipal Jwt jwt,
            @Valid @RequestBody ApplicationCreateRequest request) {
        return service.create(userId(jwt), request);
    }

    @Operation(summary = "4.2 지원서 조회")
    @ApiResponse(responseCode = "200", description = "본인 지원서")
    @ApiResponse(responseCode = "404", description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서")
    @GetMapping("/{applicationId}")
    public ApplicationResponse get(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "지원서 id", example = "10") @PathVariable long applicationId) {
        return service.get(userId(jwt), applicationId);
    }

    @Operation(summary = "4.3 지원서 목록", description = "최근에 작성한 순으로 준다. 자기소개서 본문은 빠져 있다(4.2로 조회).")
    @ApiResponse(responseCode = "200", description = "항상. 없으면 빈 목록")
    @GetMapping
    public PagedModel<ApplicationListItem> list(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "10")
                    @RequestParam(defaultValue = "10")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        return service.list(userId(jwt), page, size);
    }

    @Operation(summary = "4.4 지원서 수정", description = "보낸 필드만 수정한다. 면접에 쓴 지원서는 수정할 수 없다.")
    @ApiResponse(responseCode = "200", description = "수정. 응답은 4.1과 같음")
    @ApiResponse(responseCode = "404", description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서")
    @ApiResponse(responseCode = "409", description = "APPLICATION_IN_USE: 면접에 쓴 지원서")
    @PatchMapping("/{applicationId}")
    public ApplicationResponse update(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "지원서 id", example = "10") @PathVariable long applicationId,
            @Valid @RequestBody ApplicationUpdateRequest request) {
        return service.update(userId(jwt), applicationId, request);
    }

    @Operation(summary = "4.5 지원서 삭제", description = "지원서를 삭제한다. 면접에 쓴 지원서는 삭제할 수 없다.")
    @ApiResponse(responseCode = "204", description = "삭제")
    @ApiResponse(responseCode = "404", description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서")
    @ApiResponse(responseCode = "409", description = "APPLICATION_IN_USE: 면접에 쓴 지원서")
    @DeleteMapping("/{applicationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "지원서 id", example = "12") @PathVariable long applicationId) {
        service.delete(userId(jwt), applicationId);
    }

    private static long userId(Jwt jwt) {
        return Long.parseLong(jwt.getSubject());
    }
}
