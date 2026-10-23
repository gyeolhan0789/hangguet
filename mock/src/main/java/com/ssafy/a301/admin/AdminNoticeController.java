package com.ssafy.a301.admin;

import com.ssafy.a301.admin.AdminDtos.NoticeCreateRequest;
import com.ssafy.a301.admin.AdminDtos.NoticeListItem;
import com.ssafy.a301.admin.AdminDtos.NoticeResponse;
import com.ssafy.a301.admin.AdminDtos.NoticeUpdateRequest;
import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ErrorCode;
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
import tools.jackson.core.type.TypeReference;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/admin/notices")
public class AdminNoticeController {

    private static final String NOTICE =
            """
            { "id": 3, "title": "10월 점검 안내", "content": "10월 30일 02:00~04:00 서비스 점검이 있어요.",
              "startsAt": "2026-10-23T09:00:00+09:00", "endsAt": "2026-10-30T04:00:00+09:00", "adminName": "운영자",
              "createdAt": "2026-10-22T18:00:00+09:00", "updatedAt": "2026-10-22T18:00:00+09:00" }\
            """;
    private static final String LIST_ITEMS =
            """
            [ { "id": 3, "title": "10월 점검 안내", "startsAt": "2026-10-23T09:00:00+09:00",
                "endsAt": "2026-10-30T04:00:00+09:00", "createdAt": "2026-10-22T18:00:00+09:00" },
              { "id": 2, "title": "채팅 면접이 열렸어요", "startsAt": "2026-10-20T09:00:00+09:00",
                "endsAt": null, "createdAt": "2026-10-19T17:30:00+09:00" } ]\
            """;
    private static final String LIST =
            """
            { "content": [
                { "id": 3, "title": "10월 점검 안내", "startsAt": "2026-10-23T09:00:00+09:00",
                  "endsAt": "2026-10-30T04:00:00+09:00", "createdAt": "2026-10-22T18:00:00+09:00" },
                { "id": 2, "title": "채팅 면접이 열렸어요", "startsAt": "2026-10-20T09:00:00+09:00",
                  "endsAt": null, "createdAt": "2026-10-19T17:30:00+09:00" } ],
              "page": { "size": 10, "number": 0, "totalElements": 2, "totalPages": 1 } }\
            """;
    private static final String ID = "공지 id. `0`이면 404(뼈대 서버)";

    private final Stub stub;

    public AdminNoticeController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "8.3 공지 목록",
            description = "삭제하지 않은 공지를 최근에 작성한 순으로 준다. 본문은 빠져 있다(8.5로 조회).")
    @ApiResponse(responseCode = "200", content = @Content(examples = @ExampleObject(value = LIST)))
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
        List<NoticeListItem> items = stub.read(LIST_ITEMS, new TypeReference<>() {});
        return new PagedModel<>(new PageImpl<>(items, PageRequest.of(page, size), items.size()));
    }

    @Operation(summary = "8.4 공지 작성", description = "공지를 저장한다. 게시 시작 일시부터 사용자에게 보인다(8.8).")
    @ApiResponse(
            responseCode = "201",
            content = @Content(examples = @ExampleObject(value = NOTICE)))
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public NoticeResponse create(@Valid @RequestBody NoticeCreateRequest request) {
        return stub.read(NOTICE, NoticeResponse.class);
    }

    @Operation(summary = "8.5 공지 조회")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = NOTICE)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "NOTICE_NOT_FOUND",
                                            value = ErrorExamples.NOTICE_NOT_FOUND)))
    @GetMapping("/{noticeId}")
    public NoticeResponse get(
            @Parameter(description = ID, example = "3") @PathVariable long noticeId) {
        Stub.notFoundIfZero(noticeId, ErrorCode.NOTICE_NOT_FOUND);
        return stub.read(NOTICE, NoticeResponse.class);
    }

    @Operation(summary = "8.6 공지 수정", description = "보낸 필드만 수정한다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = NOTICE)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "NOTICE_NOT_FOUND",
                                            value = ErrorExamples.NOTICE_NOT_FOUND)))
    @PatchMapping("/{noticeId}")
    public NoticeResponse update(
            @Parameter(description = ID, example = "3") @PathVariable long noticeId,
            @Valid @RequestBody NoticeUpdateRequest request) {
        Stub.notFoundIfZero(noticeId, ErrorCode.NOTICE_NOT_FOUND);
        return stub.read(NOTICE, NoticeResponse.class);
    }

    @Operation(summary = "8.7 공지 삭제", description = "공지를 삭제한다. 사용자에게 더 이상 보이지 않는다.")
    @ApiResponse(responseCode = "204")
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "NOTICE_NOT_FOUND",
                                            value = ErrorExamples.NOTICE_NOT_FOUND)))
    @DeleteMapping("/{noticeId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@Parameter(description = ID, example = "3") @PathVariable long noticeId) {
        Stub.notFoundIfZero(noticeId, ErrorCode.NOTICE_NOT_FOUND);
    }
}
