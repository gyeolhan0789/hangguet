package com.ssafy.a301.inquiry;

import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.inquiry.InquiryDtos.InquiryCreateRequest;
import com.ssafy.a301.inquiry.InquiryDtos.InquiryListItem;
import com.ssafy.a301.inquiry.InquiryDtos.InquiryMessage;
import com.ssafy.a301.inquiry.InquiryDtos.InquiryMessageRequest;
import com.ssafy.a301.inquiry.InquiryDtos.InquiryResponse;
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
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.type.TypeReference;

@Tag(name = "9. 문의")
@RestController
@RequestMapping("/api/v1/inquiries")
public class InquiryController {

    private static final String INQUIRY =
            """
            { "id": 7, "title": "비밀번호를 잊어버렸어요", "status": "ANSWERED",
              "createdAt": "2026-10-26T10:00:00+09:00", "updatedAt": "2026-10-26T11:30:00+09:00",
              "messages": [
                { "id": 21, "authorType": "USER", "content": "가입한 이메일은 a@ssafy.com이에요. 비밀번호를 바꿔 주세요.",
                  "createdAt": "2026-10-26T10:00:00+09:00" },
                { "id": 22, "authorType": "ADMIN", "content": "요청하신 비밀번호로 바꿨어요. 다시 로그인해 주세요.",
                  "createdAt": "2026-10-26T11:30:00+09:00" } ] }\
            """;
    private static final String CREATED =
            """
            { "id": 7, "title": "비밀번호를 잊어버렸어요", "status": "WAITING",
              "createdAt": "2026-10-26T10:00:00+09:00", "updatedAt": "2026-10-26T10:00:00+09:00",
              "messages": [
                { "id": 21, "authorType": "USER", "content": "가입한 이메일은 a@ssafy.com이에요. 비밀번호를 바꿔 주세요.",
                  "createdAt": "2026-10-26T10:00:00+09:00" } ] }\
            """;
    private static final String MESSAGE =
            """
            { "id": 23, "authorType": "USER", "content": "확인 부탁드려요.", "createdAt": "2026-10-26T12:00:00+09:00" }\
            """;
    private static final String LIST_ITEMS =
            """
            [ { "id": 7, "title": "비밀번호를 잊어버렸어요", "status": "ANSWERED",
                "createdAt": "2026-10-26T10:00:00+09:00", "updatedAt": "2026-10-26T11:30:00+09:00" },
              { "id": 4, "title": "녹화가 저장되지 않아요", "status": "CLOSED",
                "createdAt": "2026-10-20T15:00:00+09:00", "updatedAt": "2026-10-21T09:10:00+09:00" } ]\
            """;
    private static final String LIST =
            """
            { "content": [
                { "id": 7, "title": "비밀번호를 잊어버렸어요", "status": "ANSWERED",
                  "createdAt": "2026-10-26T10:00:00+09:00", "updatedAt": "2026-10-26T11:30:00+09:00" },
                { "id": 4, "title": "녹화가 저장되지 않아요", "status": "CLOSED",
                  "createdAt": "2026-10-20T15:00:00+09:00", "updatedAt": "2026-10-21T09:10:00+09:00" } ],
              "page": { "size": 10, "number": 0, "totalElements": 2, "totalPages": 1 } }\
            """;
    private static final String ID = "문의 id(문의번호). `0`이면 404(뼈대 서버)";
    private static final String CLOSED_ID = "문의 id(문의번호). `0`이면 404, `4`면 종료한 문의라 409(뼈대 서버)";
    private static final String ACCESS = "비회원 문의만: 9.1에서 정한 조회 비밀번호. 회원은 보내지 않고 로그인 토큰으로 부른다";
    private static final String NOT_FOUND_RULE =
            " 없는 문의, 다른 회원의 문의, 비회원 문의인데 조회 비밀번호가 틀리면 모두 404 INQUIRY_NOT_FOUND다.";

    private final Stub stub;

    public InquiryController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "9.1 문의 작성",
            description =
                    "제목과 첫 질문으로 문의를 남긴다(상태 WAITING). 로그인했으면 회원 문의, 로그인하지 않았으면 비회원 문의이고"
                            + " 비회원은 email · accessPassword가 필수다. 응답의 id가 문의번호이며, 비회원은 문의번호와 조회"
                            + " 비밀번호로 9.3 ~ 9.5를 부른다. 제목 · 본문은 암호화해 저장한다.")
    @ApiResponse(
            responseCode = "201",
            content = @Content(examples = @ExampleObject(value = CREATED)))
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public InquiryResponse create(@Valid @RequestBody InquiryCreateRequest request) {
        return stub.read(CREATED, InquiryResponse.class);
    }

    @Operation(
            summary = "9.2 내 문의 목록",
            description = "회원만: 내가 남긴 문의를 최근에 작성한 순으로 준다. 메시지는 빠져 있다(9.3으로 조회).")
    @ApiResponse(responseCode = "200", content = @Content(examples = @ExampleObject(value = LIST)))
    @GetMapping
    public PagedModel<InquiryListItem> list(
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "10")
                    @RequestParam(defaultValue = "10")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        List<InquiryListItem> items = stub.read(LIST_ITEMS, new TypeReference<>() {});
        return new PagedModel<>(new PageImpl<>(items, PageRequest.of(page, size), items.size()));
    }

    @Operation(summary = "9.3 문의 조회", description = "문의와 주고받은 메시지(오래된 순)를 준다." + NOT_FOUND_RULE)
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
    @GetMapping("/{inquiryId}")
    public InquiryResponse get(
            @Parameter(description = ID, example = "7") @PathVariable long inquiryId,
            @Parameter(description = ACCESS, example = "1234")
                    @RequestHeader(value = "X-Inquiry-Password", required = false)
                    String accessPassword) {
        Stub.notFoundIfZero(inquiryId, ErrorCode.INQUIRY_NOT_FOUND);
        return stub.read(INQUIRY, InquiryResponse.class);
    }

    @Operation(
            summary = "9.4 문의 이어서 쓰기",
            description =
                    "같은 문의에 질문을 하나 더 단다. 상태는 WAITING(답변 대기)이 된다. 종료한 문의면 409 INQUIRY_CLOSED다."
                            + NOT_FOUND_RULE)
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
    @PostMapping("/{inquiryId}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public InquiryMessage addMessage(
            @Parameter(description = CLOSED_ID, example = "7") @PathVariable long inquiryId,
            @Parameter(description = ACCESS, example = "1234")
                    @RequestHeader(value = "X-Inquiry-Password", required = false)
                    String accessPassword,
            @Valid @RequestBody InquiryMessageRequest request) {
        InquiryStubs.closedOr404(inquiryId);
        return stub.read(MESSAGE, InquiryMessage.class);
    }

    @Operation(
            summary = "9.5 문의 종료",
            description = "문의를 종료한다(상태 CLOSED). 종료한 문의에는 더 쓸 수 없다. 이미 종료했어도 204다." + NOT_FOUND_RULE)
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
    @PostMapping("/{inquiryId}/close")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void close(
            @Parameter(description = ID, example = "7") @PathVariable long inquiryId,
            @Parameter(description = ACCESS, example = "1234")
                    @RequestHeader(value = "X-Inquiry-Password", required = false)
                    String accessPassword) {
        Stub.notFoundIfZero(inquiryId, ErrorCode.INQUIRY_NOT_FOUND);
    }
}
