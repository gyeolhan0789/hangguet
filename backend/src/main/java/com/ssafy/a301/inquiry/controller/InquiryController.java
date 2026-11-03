package com.ssafy.a301.inquiry.controller;

import com.ssafy.a301.common.web.CurrentUserId;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AttachmentUploadUrlRequest;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AttachmentUploadUrlResponse;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryCreateRequest;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryListItem;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryMessage;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryQuestionRequest;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryResponse;
import com.ssafy.a301.inquiry.service.InquiryService;
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
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 9.1 ~ 9.5 · 9.11. 9.2를 뺀 API는 로그인하지 않아도 부를 수 있다(SecurityConfig). 비회원은 X-Inquiry-Password로 본인을
 * 확인한다.
 */
@Tag(name = "9. 문의")
@RestController
@RequestMapping("/api/v1/inquiries")
public class InquiryController {
    private static final String ACCESS = "비회원 문의만: 9.1에서 정한 조회 비밀번호. 회원은 보내지 않고 로그인 토큰으로 부른다";
    private static final String NOT_FOUND =
            "INQUIRY_NOT_FOUND: 없는 문의, 다른 회원의 문의, 비회원 문의인데 조회 비밀번호가 틀림";
    private static final String NOT_FOUND_RULE =
            " 없는 문의, 다른 회원의 문의, 비회원 문의인데 조회 비밀번호가 틀리면 모두 404 INQUIRY_NOT_FOUND다.";

    private final InquiryService service;

    public InquiryController(InquiryService service) {
        this.service = service;
    }

    @Operation(
            summary = "9.1 문의 작성",
            description =
                    "제목과 첫 질문으로 문의를 남긴다(상태 WAITING). 로그인했으면 회원 문의, 로그인하지 않았으면 비회원 문의이고"
                            + " 비회원은 email · accessPassword가 필수다. 응답의 id가 문의번호이며, 비회원은 문의번호와 조회"
                            + " 비밀번호로 9.3 ~ 9.5를 부른다. 제목 · 본문은 암호화해 저장한다. 사진은 9.11로 올린 뒤"
                            + " attachmentKeys로 붙인다(5장까지).")
    @ApiResponse(responseCode = "201", description = "저장. 메시지는 첫 질문 하나")
    @ApiResponse(
            responseCode = "400",
            description = "VALIDATION_FAILED: attachmentKeys가 발급되지 않았거나 이미 쓴 키, 같은 키를 두 번 보냄")
    @ApiResponse(responseCode = "404", description = "FILE_NOT_FOUND: 키는 맞지만 S3에 사진이 없음")
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public InquiryResponse create(
            @AuthenticationPrincipal Jwt jwt, @Valid @RequestBody InquiryCreateRequest request) {
        return service.create(userId(jwt), request);
    }

    @Operation(
            summary = "9.2 내 문의 목록",
            description = "회원만: 내가 남긴 문의를 최근에 작성한 순으로 준다. 메시지는 빠져 있다(9.3으로 조회).")
    @ApiResponse(responseCode = "200", description = "항상. 없으면 빈 목록")
    @GetMapping
    public PagedModel<InquiryListItem> list(
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

    @Operation(summary = "9.3 문의 조회", description = "문의와 주고받은 메시지(오래된 순)를 준다." + NOT_FOUND_RULE)
    @ApiResponse(responseCode = "200", description = "문의 · 메시지")
    @ApiResponse(responseCode = "404", description = NOT_FOUND)
    @GetMapping("/{inquiryId}")
    public InquiryResponse get(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "문의 id(문의번호)", example = "7") @PathVariable long inquiryId,
            @Parameter(description = ACCESS, example = "1234")
                    @RequestHeader(value = "X-Inquiry-Password", required = false)
                    String accessPassword) {
        return service.get(userId(jwt), inquiryId, accessPassword);
    }

    @Operation(
            summary = "9.4 문의 이어서 쓰기",
            description =
                    "같은 문의에 질문을 하나 더 단다. 상태는 WAITING(답변 대기)이 된다. 종료한 문의면 409 INQUIRY_CLOSED다."
                            + " 사진은 9.1과 같이 attachmentKeys로 붙인다."
                            + NOT_FOUND_RULE)
    @ApiResponse(responseCode = "201", description = "단 메시지")
    @ApiResponse(
            responseCode = "400",
            description = "VALIDATION_FAILED: attachmentKeys가 발급되지 않았거나 이미 쓴 키, 같은 키를 두 번 보냄")
    @ApiResponse(
            responseCode = "404",
            description = NOT_FOUND + " / FILE_NOT_FOUND: 키는 맞지만 S3에 사진이 없음")
    @ApiResponse(responseCode = "409", description = "INQUIRY_CLOSED: 종료한 문의")
    @PostMapping("/{inquiryId}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public InquiryMessage addMessage(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "문의 id(문의번호)", example = "7") @PathVariable long inquiryId,
            @Parameter(description = ACCESS, example = "1234")
                    @RequestHeader(value = "X-Inquiry-Password", required = false)
                    String accessPassword,
            @Valid @RequestBody InquiryQuestionRequest request) {
        return service.addQuestion(userId(jwt), inquiryId, accessPassword, request);
    }

    @Operation(
            summary = "9.5 문의 종료",
            description = "문의를 종료한다(상태 CLOSED). 종료한 문의에는 더 쓸 수 없다. 이미 종료했어도 204다." + NOT_FOUND_RULE)
    @ApiResponse(responseCode = "204", description = "종료")
    @ApiResponse(responseCode = "404", description = NOT_FOUND)
    @PostMapping("/{inquiryId}/close")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void close(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "문의 id(문의번호)", example = "7") @PathVariable long inquiryId,
            @Parameter(description = ACCESS, example = "1234")
                    @RequestHeader(value = "X-Inquiry-Password", required = false)
                    String accessPassword) {
        service.close(userId(jwt), inquiryId, accessPassword);
    }

    @Operation(
            summary = "9.11 문의 사진 업로드 주소",
            description =
                    "사진마다 받은 uploadUrl로 요청한 형식(Content-Type)과 크기의 파일을 PUT한 뒤, 9.1 · 9.4의"
                        + " attachmentKeys에 objectKey를 보낸다. 로그인하지 않아도 부를 수 있다. objectKey는 받은 사람만 알며"
                        + " 1시간 안에 한 번만 쓸 수 있다(uploadUrl은 expiresAt까지).")
    @ApiResponse(responseCode = "200", description = "요청한 순서대로 사진마다 주소")
    @PostMapping("/attachments/upload-url")
    public AttachmentUploadUrlResponse attachmentUploadUrls(
            @Valid @RequestBody AttachmentUploadUrlRequest request) {
        return service.attachmentUploadUrls(request.files());
    }

    // 로그인하지 않았으면 없음(비회원)
    private static Long userId(Jwt jwt) {
        return jwt == null ? null : Long.parseLong(jwt.getSubject());
    }
}
