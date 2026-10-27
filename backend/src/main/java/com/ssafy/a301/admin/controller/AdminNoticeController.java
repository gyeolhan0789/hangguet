package com.ssafy.a301.admin.controller;

import com.ssafy.a301.admin.dto.AdminDtos.NoticeCreateRequest;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeListItem;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeResponse;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeUpdateRequest;
import com.ssafy.a301.admin.service.AdminNoticeService;
import com.ssafy.a301.common.web.CurrentAdminId;
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
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/admin/notices")
public class AdminNoticeController {
    private final AdminNoticeService service;

    public AdminNoticeController(AdminNoticeService service) {
        this.service = service;
    }

    @Operation(
            summary = "8.3 공지 목록",
            description = "삭제하지 않은 공지를 최근에 작성한 순으로 준다. 본문은 빠져 있다(8.5로 조회).")
    @ApiResponse(responseCode = "200", description = "항상. 없으면 빈 목록")
    @GetMapping
    public PagedModel<NoticeListItem> list(
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "10")
                    @RequestParam(defaultValue = "10")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        return service.list(page, size);
    }

    @Operation(summary = "8.4 공지 작성", description = "공지를 저장한다. 게시 시작 일시부터 사용자에게 보인다(8.8).")
    @ApiResponse(responseCode = "201", description = "작성")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public NoticeResponse create(
            @CurrentAdminId long adminId, @Valid @RequestBody NoticeCreateRequest request) {
        return service.create(adminId, request);
    }

    @Operation(summary = "8.5 공지 조회")
    @ApiResponse(responseCode = "200", description = "조회")
    @ApiResponse(responseCode = "404", description = "NOTICE_NOT_FOUND: 없거나 삭제한 공지")
    @GetMapping("/{noticeId}")
    public NoticeResponse get(
            @Parameter(description = "공지 id", example = "3") @PathVariable long noticeId) {
        return service.get(noticeId);
    }

    @Operation(
            summary = "8.6 공지 수정",
            description = "보낸 필드만 수정한다. endsAt을 null로 보내면 게시 종료를 지워 계속 보여 준다.")
    @ApiResponse(responseCode = "200", description = "수정")
    @ApiResponse(responseCode = "404", description = "NOTICE_NOT_FOUND: 없거나 삭제한 공지")
    @PatchMapping("/{noticeId}")
    public NoticeResponse update(
            @Parameter(description = "공지 id", example = "3") @PathVariable long noticeId,
            @Valid @RequestBody NoticeUpdateRequest request) {
        return service.update(noticeId, request);
    }

    @Operation(summary = "8.7 공지 삭제", description = "공지를 삭제한다. 사용자에게 더 이상 보이지 않는다.")
    @ApiResponse(responseCode = "204", description = "삭제")
    @ApiResponse(responseCode = "404", description = "NOTICE_NOT_FOUND: 없거나 이미 삭제한 공지")
    @DeleteMapping("/{noticeId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @Parameter(description = "공지 id", example = "3") @PathVariable long noticeId) {
        service.delete(noticeId);
    }
}
