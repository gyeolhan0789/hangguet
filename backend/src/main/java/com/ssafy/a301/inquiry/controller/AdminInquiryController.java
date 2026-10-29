package com.ssafy.a301.inquiry.controller;

import com.ssafy.a301.common.web.CurrentAdminId;
import com.ssafy.a301.inquiry.domain.InquiryStatus;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminInquiryListItem;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminInquiryMessage;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminInquiryResponse;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminPasswordChangeRequest;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryMessageRequest;
import com.ssafy.a301.inquiry.service.AdminInquiryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.data.web.PagedModel;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 9.6 ~ 9.10. /api/v1/admin/** 라 관리자 토큰으로만 부른다(AdminSecurityConfig). */
@Tag(name = "9. 문의")
@RestController
@RequestMapping("/api/v1/admin")
public class AdminInquiryController {
    private static final String ID = "문의 id(문의번호)";

    private final AdminInquiryService service;

    public AdminInquiryController(AdminInquiryService service) {
        this.service = service;
    }

    @Operation(
            summary = "9.6 문의 목록",
            description = "회원 · 비회원 문의를 최근에 작성한 순으로 준다. status를 보내면 그 상태만 준다. 메시지는 빠져 있다(9.7로 조회).")
    @ApiResponse(responseCode = "200", description = "항상. 없으면 빈 목록")
    @GetMapping("/inquiries")
    public PagedModel<AdminInquiryListItem> list(
            @Parameter(description = "이 상태만 보기. 보내지 않으면 전부", example = "WAITING")
                    @RequestParam(required = false)
                    InquiryStatus status,
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "10")
                    @RequestParam(defaultValue = "10")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        return service.list(status, page, size);
    }

    @Operation(
            summary = "9.7 문의 조회",
            description = "문의와 주고받은 메시지(오래된 순)를 준다. 비회원 문의면 userId · nickname이 없다.")
    @ApiResponse(responseCode = "200", description = "문의 · 메시지")
    @ApiResponse(responseCode = "404", description = "INQUIRY_NOT_FOUND")
    @GetMapping("/inquiries/{inquiryId}")
    public AdminInquiryResponse get(
            @Parameter(description = ID, example = "7") @PathVariable long inquiryId) {
        return service.get(inquiryId);
    }

    @Operation(
            summary = "9.8 문의 답변",
            description = "문의에 답변을 단다. 상태는 ANSWERED(답변함)가 된다. 종료한 문의면 409 INQUIRY_CLOSED다.")
    @ApiResponse(responseCode = "201", description = "단 답변")
    @ApiResponse(responseCode = "404", description = "INQUIRY_NOT_FOUND")
    @ApiResponse(responseCode = "409", description = "INQUIRY_CLOSED: 종료한 문의")
    @PostMapping("/inquiries/{inquiryId}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public AdminInquiryMessage answer(
            @CurrentAdminId long adminId,
            @Parameter(description = ID, example = "7") @PathVariable long inquiryId,
            @Valid @RequestBody InquiryMessageRequest request) {
        return service.answer(adminId, inquiryId, request.content());
    }

    @Operation(
            summary = "9.9 문의 종료",
            description = "문의를 종료한다(상태 CLOSED). 종료한 문의에는 더 쓸 수 없다. 이미 종료했어도 204다.")
    @ApiResponse(responseCode = "204", description = "종료")
    @ApiResponse(responseCode = "404", description = "INQUIRY_NOT_FOUND")
    @PostMapping("/inquiries/{inquiryId}/close")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void close(@Parameter(description = ID, example = "7") @PathVariable long inquiryId) {
        service.close(inquiryId);
    }

    @Operation(
            summary = "9.10 회원 비밀번호 변경",
            description =
                    "관리자가 회원의 비밀번호를 바꾼다(문의로 요청받은 경우 등). 비밀번호 변경 기록을 남기고, 그 회원이 로그인해 둔"
                            + " 모든 기기를 로그아웃한다(리프레시 토큰 무효). inquiryId를 보내면 기록에 그 문의를 함께 남긴다."
                            + " 회원 찾기는 8.12 회원 검색을 쓴다.")
    @ApiResponse(responseCode = "204", description = "변경")
    @ApiResponse(
            responseCode = "404",
            description = "USER_NOT_FOUND: 없거나 탈퇴한 회원 · INQUIRY_NOT_FOUND: 보낸 문의가 없음")
    @ApiResponse(responseCode = "409", description = "PASSWORD_NOT_SET: 비밀번호가 없는 소셜 회원")
    @PatchMapping("/users/{userId}/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(
            @CurrentAdminId long adminId,
            @Parameter(description = "회원 id", example = "12") @PathVariable long userId,
            @Valid @RequestBody AdminPasswordChangeRequest request) {
        service.changeUserPassword(adminId, userId, request);
    }
}
