package com.ssafy.a301.admin;

import com.ssafy.a301.admin.AdminDtos.UnreadNoticesResponse;
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

    private static final String UNREAD =
            """
            { "content": [
                { "id": 3, "title": "10월 점검 안내", "content": "10월 30일 02:00~04:00 서비스 점검이 있어요.",
                  "startsAt": "2026-10-23T09:00:00+09:00" },
                { "id": 2, "title": "채팅 면접이 열렸어요", "content": "이제 글로도 면접을 볼 수 있어요.",
                  "startsAt": "2026-10-20T09:00:00+09:00" } ] }\
            """;
    private static final String UNREAD_EMPTY = "{ \"content\": [] }";

    private final Stub stub;

    public NoticeController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "8.8 확인하지 않은 공지",
            description = "게시 중인데 이 회원이 확인(8.9)하지 않은 공지를 최신순(게시 시작 일시 내림차순)으로 준다. 화면은 차례대로 보여 준다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "확인하지 않은 공지 2개", value = UNREAD),
                                @ExampleObject(name = "모두 확인함", value = UNREAD_EMPTY)
                            }))
    @GetMapping("/unread")
    public UnreadNoticesResponse unread() {
        return stub.read(UNREAD, UnreadNoticesResponse.class);
    }

    @Operation(
            summary = "8.9 공지 확인",
            description = "[확인]을 누른 공지를 기록한다. 그 공지는 8.8에 다시 나오지 않는다. 이미 확인했어도 204다.")
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
