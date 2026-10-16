package com.ssafy.a301.application;

import com.ssafy.a301.application.ApplicationDtos.ApplicationCreateRequest;
import com.ssafy.a301.application.ApplicationDtos.ApplicationListItem;
import com.ssafy.a301.application.ApplicationDtos.ApplicationResponse;
import com.ssafy.a301.application.ApplicationDtos.ApplicationUpdateRequest;
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

@Tag(name = "4. 지원서")
@RestController
@RequestMapping("/api/v1/applications")
public class ApplicationController {

    private static final String APPLICATION =
            """
            { "id": 10, "companyName": "○○전자", "jobTitle": "백엔드 개발자", "coverLetter": "1. 지원 동기\\n저는…",
              "createdAt": "2026-10-15T11:55:00+09:00", "inUse": false }\
            """;
    private static final String LIST_ITEMS =
            """
            [ { "id": 12, "companyName": "○○전자", "jobTitle": "백엔드 개발자", "createdAt": "2026-10-15T11:55:00+09:00", "inUse": false },
              { "id": 9, "companyName": "△△소프트", "jobTitle": "서버 개발자", "createdAt": "2026-10-11T20:10:00+09:00", "inUse": true } ]\
            """;
    private static final String LIST =
            """
            { "content": [
                { "id": 12, "companyName": "○○전자", "jobTitle": "백엔드 개발자", "createdAt": "2026-10-15T11:55:00+09:00", "inUse": false },
                { "id": 9, "companyName": "△△소프트", "jobTitle": "서버 개발자", "createdAt": "2026-10-11T20:10:00+09:00", "inUse": true } ],
              "page": { "size": 10, "number": 0, "totalElements": 2, "totalPages": 1 } }\
            """;
    private static final String ID = "지원서 id. `0`이면 404(뼈대 서버)";

    private final Stub stub;

    public ApplicationController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "4.1 지원서 작성",
            description =
                    """
                    **화면 — S03 지원서 › [새 지원서 작성] 후 [다음: 면접관 선택]**

                    지원서를 저장해 두고 여러 면접에 다시 쓴다(S03에서 저장된 지원서 중 고르거나 새로 작성). 자기소개서는 질문 생성과 "자소서 검증" 평가에 쓴다.

                    - **201**: 저장\
                    """)
    @ApiResponse(
            responseCode = "201",
            content = @Content(examples = @ExampleObject(value = APPLICATION)))
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApplicationResponse create(@Valid @RequestBody ApplicationCreateRequest request) {
        return stub.read(APPLICATION, ApplicationResponse.class);
    }

    @Operation(
            summary = "4.2 지원서 조회",
            description =
                    """
                    **화면 — S03 저장된 지원서 선택 시 내용 보기, S04·S05-1 상단 "○○전자 · 백엔드 개발자", S04 [← 지원서 수정] 시 S03 채우기**

                    - **200**: 본인 지원서
                    - **404 / APPLICATION_NOT_FOUND**: 없거나 남의 지원서\
                    """)
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = APPLICATION)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "APPLICATION_NOT_FOUND",
                                            value = ErrorExamples.APPLICATION_NOT_FOUND)))
    @GetMapping("/{applicationId}")
    public ApplicationResponse get(
            @Parameter(description = ID, example = "10") @PathVariable long applicationId) {
        Stub.notFoundIfZero(applicationId, ErrorCode.APPLICATION_NOT_FOUND);
        return stub.read(APPLICATION, ApplicationResponse.class);
    }

    @Operation(
            summary = "4.3 지원서 목록",
            description =
                    """
                    **화면 — S03 지원서 › 저장된 지원서 목록**

                    최근 작성 순. 목록에는 자기소개서 본문을 넣지 않는다(선택하면 4.2).

                    - **200**: 항상. 없으면 빈 배열 → S03은 바로 새로 작성 화면\
                    """)
    @ApiResponse(responseCode = "200", content = @Content(examples = @ExampleObject(value = LIST)))
    @GetMapping
    public PagedModel<ApplicationListItem> list(
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "10")
                    @RequestParam(defaultValue = "10")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        List<ApplicationListItem> items = stub.read(LIST_ITEMS, new TypeReference<>() {});
        return new PagedModel<>(new PageImpl<>(items, PageRequest.of(page, size), items.size()));
    }

    @Operation(
            summary = "4.4 지원서 수정",
            description =
                    """
                    **화면 — S03 저장된 지원서 › 수정, S04 [← 지원서 수정]**

                    보낸 필드만 바꾼다. 이미 면접에 쓴 지원서는 고칠 수 없다(지난 결과가 바뀌지 않도록). 화면은 내용을 채운 새 작성(4.1)으로 안내한다.

                    - **200**: 수정. 응답은 4.1과 같음
                    - **404 / APPLICATION_NOT_FOUND**
                    - **409 / APPLICATION_IN_USE**: 면접에 쓴 지원서\
                    """)
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = APPLICATION)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "APPLICATION_NOT_FOUND",
                                            value = ErrorExamples.APPLICATION_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "APPLICATION_IN_USE",
                                            value = ErrorExamples.APPLICATION_IN_USE)))
    @PatchMapping("/{applicationId}")
    public ApplicationResponse update(
            @Parameter(description = ID, example = "10") @PathVariable long applicationId,
            @Valid @RequestBody ApplicationUpdateRequest request) {
        Stub.notFoundIfZero(applicationId, ErrorCode.APPLICATION_NOT_FOUND);
        return stub.read(APPLICATION, ApplicationResponse.class);
    }

    @Operation(
            summary = "4.5 지원서 삭제",
            description =
                    """
                    **화면 — S03 저장된 지원서 › 삭제**

                    지원서를 지운다. 이미 면접에 쓴 지원서는 지울 수 없다(지난 결과·다시보기가 이 지원서를 보여 준다).

                    - **204**: 삭제
                    - **404 / APPLICATION_NOT_FOUND**: 없거나 남의 지원서
                    - **409 / APPLICATION_IN_USE**: 면접에 쓴 지원서\
                    """)
    @ApiResponse(responseCode = "204")
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "APPLICATION_NOT_FOUND",
                                            value = ErrorExamples.APPLICATION_NOT_FOUND)))
    @ApiResponse(
            responseCode = "409",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "APPLICATION_IN_USE",
                                            value = ErrorExamples.APPLICATION_IN_USE)))
    @DeleteMapping("/{applicationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @Parameter(description = ID, example = "12") @PathVariable long applicationId) {
        Stub.notFoundIfZero(applicationId, ErrorCode.APPLICATION_NOT_FOUND);
    }
}
