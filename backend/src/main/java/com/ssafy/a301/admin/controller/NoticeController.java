package com.ssafy.a301.admin.controller;

import com.ssafy.a301.admin.dto.AdminDtos.NoticesResponse;
import com.ssafy.a301.admin.service.NoticeService;
import com.ssafy.a301.common.web.CurrentUserId;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/notices")
public class NoticeController {
    private final NoticeService service;

    public NoticeController(NoticeService service) {
        this.service = service;
    }

    @Operation(
            summary = "8.8 공지 목록",
            description = "게시 중인 공지를 최신순(게시 시작 일시 내림차순)으로 준다. 공지마다 이 회원의 확인(8.9) 여부(read)를 함께 준다.")
    @GetMapping
    public NoticesResponse notices(@CurrentUserId long userId) {
        return service.notices(userId);
    }

    @Operation(
            summary = "8.9 공지 확인",
            description = "[확인]을 누른 공지를 기록한다. 8.8에서 그 공지는 read가 true가 된다. 이미 확인했어도 204다.")
    @ApiResponse(responseCode = "204", description = "확인")
    @ApiResponse(responseCode = "404", description = "NOTICE_NOT_FOUND: 없는 공지")
    @PostMapping("/{noticeId}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(
            @CurrentUserId long userId,
            @Parameter(description = "공지 id", example = "3") @PathVariable long noticeId) {
        service.read(userId, noticeId);
    }
}
