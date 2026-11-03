package com.ssafy.a301.inquiry;

import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.inquiry.InquiryDtos.AdminInquiryListItem;
import com.ssafy.a301.inquiry.InquiryDtos.AdminInquiryMessage;
import com.ssafy.a301.inquiry.InquiryDtos.AdminInquiryResponse;
import com.ssafy.a301.inquiry.InquiryDtos.AdminPasswordChangeRequest;
import com.ssafy.a301.inquiry.InquiryDtos.InquiryMessageRequest;
import com.ssafy.a301.inquiry.InquiryDtos.InquiryStatus;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.List;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
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
import tools.jackson.core.type.TypeReference;

@Tag(name = "9. 문의")
@RestController
@RequestMapping("/api/v1/admin")
public class AdminInquiryController {

    private static final String INQUIRY =
            """
            { "id": 7, "title": "비밀번호를 잊어버렸어요", "status": "WAITING", "userId": null, "nickname": null,
              "email": "a@ssafy.com", "createdAt": "2026-10-26T10:00:00+09:00", "updatedAt": "2026-10-26T10:00:00+09:00",
              "messages": [
                { "id": 21, "authorType": "USER", "adminName": null,
                  "content": "가입한 이메일은 a@ssafy.com이에요. 비밀번호를 바꿔 주세요.",
                  "createdAt": "2026-10-26T10:00:00+09:00",
                  "attachments": [ { "id": 3, "url": "https://…s3…/inquiry/7f3c….png?X-Amz-Signature=…" } ] } ] }\
            """;
    private static final String MESSAGE =
            """
            { "id": 22, "authorType": "ADMIN", "adminName": "운영자",
              "content": "요청하신 비밀번호로 바꿨어요. 다시 로그인해 주세요.", "createdAt": "2026-10-26T11:30:00+09:00",
              "attachments": [] }\
            """;
    private static final String LIST_ITEMS =
            """
            [ { "id": 7, "title": "비밀번호를 잊어버렸어요", "status": "WAITING", "userId": null, "email": "a@ssafy.com",
                "createdAt": "2026-10-26T10:00:00+09:00", "updatedAt": "2026-10-26T10:00:00+09:00" },
              { "id": 4, "title": "녹화가 저장되지 않아요", "status": "CLOSED", "userId": 12, "email": "b@ssafy.com",
                "createdAt": "2026-10-20T15:00:00+09:00", "updatedAt": "2026-10-21T09:10:00+09:00" } ]\
            """;
    private static final String LIST =
            """
            { "content": [
                { "id": 7, "title": "비밀번호를 잊어버렸어요", "status": "WAITING", "userId": null, "email": "a@ssafy.com",
                  "createdAt": "2026-10-26T10:00:00+09:00", "updatedAt": "2026-10-26T10:00:00+09:00" },
                { "id": 4, "title": "녹화가 저장되지 않아요", "status": "CLOSED", "userId": 12, "email": "b@ssafy.com",
                  "createdAt": "2026-10-20T15:00:00+09:00", "updatedAt": "2026-10-21T09:10:00+09:00" } ],
              "page": { "size": 10, "number": 0, "totalElements": 2, "totalPages": 1 } }\
            """;
    private static final String ID = "문의 id(문의번호). `0`이면 404(뼈대 서버)";
    private static final String CLOSED_ID = "문의 id(문의번호). `0`이면 404, `4`면 종료한 문의라 409(뼈대 서버)";

    private final Stub stub;

    public AdminInquiryController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "9.6 문의 목록",
            description = "회원 · 비회원 문의를 최근에 작성한 순으로 준다. status를 보내면 그 상태만 준다. 메시지는 빠져 있다(9.7로 조회).")
    @ApiResponse(responseCode = "200", content = @Content(examples = @ExampleObject(value = LIST)))
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
        List<AdminInquiryListItem> items = stub.read(LIST_ITEMS, new TypeReference<>() {});
        return new PagedModel<>(new PageImpl<>(items, PageRequest.of(page, size), items.size()));
    }

    @Operation(
            summary = "9.7 문의 조회",
            description = "문의와 주고받은 메시지(오래된 순)를 준다. 비회원 문의면 userId · nickname이 없다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = INQUIRY)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "INQUIRY_NOT_FOUND",
                                            value = ErrorExamples.INQUIRY_NOT_FOUND)))
    @GetMapping("/inquiries/{inquiryId}")
    public AdminInquiryResponse get(
            @Parameter(description = ID, example = "7") @PathVariable long inquiryId) {
        Stub.notFoundIfZero(inquiryId, ErrorCode.INQUIRY_NOT_FOUND);
        return stub.read(INQUIRY, AdminInquiryResponse.class);
    }

    @Operation(
            summary = "9.8 문의 답변",
            description = "문의에 답변을 단다. 상태는 ANSWERED(답변함)가 된다. 종료한 문의면 409 INQUIRY_CLOSED다.")
    @ApiResponse(
            responseCode = "201",
            content = @Content(examples = @ExampleObject(value = MESSAGE)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "INQUIRY_NOT_FOUND",
                                            value = ErrorExamples.INQUIRY_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "INQUIRY_CLOSED",
                                            value = ErrorExamples.INQUIRY_CLOSED)))
    @PostMapping("/inquiries/{inquiryId}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public AdminInquiryMessage answer(
            @Parameter(description = CLOSED_ID, example = "7") @PathVariable long inquiryId,
            @Valid @RequestBody InquiryMessageRequest request) {
        InquiryStubs.closedOr404(inquiryId);
        return stub.read(MESSAGE, AdminInquiryMessage.class);
    }

    @Operation(
            summary = "9.9 문의 종료",
            description = "문의를 종료한다(상태 CLOSED). 종료한 문의에는 더 쓸 수 없다. 이미 종료했어도 204다.")
    @ApiResponse(responseCode = "204")
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "INQUIRY_NOT_FOUND",
                                            value = ErrorExamples.INQUIRY_NOT_FOUND)))
    @PostMapping("/inquiries/{inquiryId}/close")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void close(@Parameter(description = ID, example = "7") @PathVariable long inquiryId) {
        Stub.notFoundIfZero(inquiryId, ErrorCode.INQUIRY_NOT_FOUND);
    }

    @Operation(
            summary = "9.10 회원 비밀번호 변경",
            description =
                    "관리자가 회원의 비밀번호를 바꾼다(문의로 요청받은 경우 등). 비밀번호 변경 기록을 남기고, 그 회원이 로그인해 둔"
                            + " 모든 기기를 로그아웃한다(리프레시 토큰 무효). inquiryId를 보내면 기록에 그 문의를 함께 남긴다."
                            + " 회원 찾기는 8.12 회원 검색을 쓴다.")
    @ApiResponse(responseCode = "204")
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples = {
                                @ExampleObject(
                                        name = "USER_NOT_FOUND",
                                        value = ErrorExamples.USER_NOT_FOUND),
                                @ExampleObject(
                                        name = "INQUIRY_NOT_FOUND",
                                        value = ErrorExamples.INQUIRY_NOT_FOUND)
                            }))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "PASSWORD_NOT_SET",
                                            value = ErrorExamples.PASSWORD_NOT_SET)))
    @PatchMapping("/users/{userId}/password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void changePassword(
            @Parameter(description = "회원 id. `0`이면 404 USER_NOT_FOUND(뼈대 서버)", example = "12")
                    @PathVariable
                    long userId,
            @Valid @RequestBody AdminPasswordChangeRequest request) {
        Stub.notFoundIfZero(userId, ErrorCode.USER_NOT_FOUND);
        if (request.inquiryId() != null) {
            Stub.notFoundIfZero(request.inquiryId(), ErrorCode.INQUIRY_NOT_FOUND);
        }
    }
}
