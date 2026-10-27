package com.ssafy.a301.admin;

import com.ssafy.a301.admin.AdminDtos.NoticesResponse;
import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
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

    private static final String NOTICES =
            """
            { "content": [
                { "id": 3, "title": "10월 점검 안내", "content": "10월 30일 02:00~04:00 서비스 점검이 있어요.",
                  "startsAt": "2026-10-23T09:00:00+09:00", "read": false },
                { "id": 2, "title": "채팅 면접이 열렸어요", "content": "이제 글로도 면접을 볼 수 있어요.",
                  "startsAt": "2026-10-20T09:00:00+09:00", "read": true } ] }\
            """;
    private static final String EMPTY = "{ \"content\": [] }";

    private final Stub stub;

    public NoticeController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "8.8 공지 목록",
            description = "게시 중인 공지를 최신순(게시 시작 일시 내림차순)으로 준다. 공지마다 이 회원의 확인(8.9) 여부(read)를 함께 준다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "확인 안 함 1개 · 확인함 1개", value = NOTICES),
                                @ExampleObject(name = "공지 없음", value = EMPTY)
                            }))
    @GetMapping
    public NoticesResponse notices() {
        return stub.read(NOTICES, NoticesResponse.class);
    }

    @Operation(
            summary = "8.9 공지 확인",
            description = "[확인]을 누른 공지를 기록한다. 8.8에서 그 공지는 read가 true가 된다. 이미 확인했어도 204다.")
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
    @PostMapping("/{noticeId}/read")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void read(
            @Parameter(description = "공지 id. `0`이면 404(뼈대 서버)", example = "3") @PathVariable
                    long noticeId) {
        Stub.notFoundIfZero(noticeId, ErrorCode.NOTICE_NOT_FOUND);
    }
}
