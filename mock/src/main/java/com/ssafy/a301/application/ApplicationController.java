package com.ssafy.a301.application;

import com.ssafy.a301.application.ApplicationDtos.ApplicationCreateRequest;
import com.ssafy.a301.application.ApplicationDtos.ApplicationListItem;
import com.ssafy.a301.application.ApplicationDtos.ApplicationResponse;
import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.InterviewDtos.SessionListItem;
import com.ssafy.a301.interview.SessionExamples;
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
import java.util.Map;
import java.util.Set;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.web.PagedModel;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
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

    private static final String CREATED =
            """
            { "id": 13, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "coverLetterItems": [
                { "itemOrder": 1, "question": "지원 동기", "answer": "저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어 ○○전자 백엔드 직무에 지원했습니다." } ],
              "createdAt": "2026-10-29T10:00:00+09:00" }\
            """;
    private static final String APPLICATION =
            """
            { "id": 12, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
              "coverLetterItems": [
                { "itemOrder": 1, "question": "지원 동기", "answer": "저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어 ○○전자 백엔드 직무에 지원했습니다." },
                { "itemOrder": 2, "question": "협업 경험", "answer": "4명이 함께한 프로젝트에서 API 설계를 맡아 조회 응답 시간을 40% 줄였습니다." } ],
              "createdAt": "2026-10-15T11:55:00+09:00" }\
            """;
    private static final String USED_APPLICATION =
            """
            { "id": 9, "companyName": "△△소프트", "jobTitle": "서버 개발자",
              "coverLetterItems": [
                { "itemOrder": 1, "question": "지원 동기", "answer": "사용자가 많은 서비스를 안정적으로 운영하고 싶어 △△소프트 서버 직무에 지원했습니다." },
                { "itemOrder": 2, "question": "성장 경험", "answer": "장애 대응을 맡으며 모니터링 지표를 직접 설계했습니다." } ],
              "createdAt": "2026-10-11T20:10:00+09:00" }\
            """;
    private static final String LIST_ITEMS =
            """
            [ { "id": 12, "companyName": "○○전자", "jobTitle": "백엔드 개발자", "createdAt": "2026-10-15T11:55:00+09:00" },
              { "id": 9, "companyName": "△△소프트", "jobTitle": "서버 개발자", "createdAt": "2026-10-11T20:10:00+09:00" } ]\
            """;
    private static final String LIST =
            """
            { "content": [
                { "id": 12, "companyName": "○○전자", "jobTitle": "백엔드 개발자", "createdAt": "2026-10-15T11:55:00+09:00" },
                { "id": 9, "companyName": "△△소프트", "jobTitle": "서버 개발자", "createdAt": "2026-10-11T20:10:00+09:00" } ],
              "page": { "size": 10, "number": 0, "totalElements": 2, "totalPages": 1 } }\
            """;
    private static final String SESSIONS =
            """
            { "content": [
                { "id": 54, "companyName": "△△소프트", "jobTitle": "서버 개발자",
                  "persona": "COFFEE_CHAT", "mode": "CHAT", "status": "ANALYZING",
                  "startedAt": "2026-10-21T19:30:00+09:00", "endedAt": "2026-10-21T19:42:00+09:00",
                  "answeredCount": 3, "summary": null, "criterionGrades": [] },
                { "id": 53, "companyName": "△△소프트", "jobTitle": "서버 개발자",
                  "persona": "COFFEE_CHAT", "mode": "VIDEO", "status": "FAILED",
                  "startedAt": "2026-10-20T21:00:00+09:00", "endedAt": "2026-10-20T21:22:00+09:00",
                  "answeredCount": 5, "summary": null, "criterionGrades": [] } ],
              "page": { "size": 10, "number": 0, "totalElements": 2, "totalPages": 1 } }\
            """;
    private static final String NO_SESSIONS =
            """
            { "content": [], "page": { "size": 10, "number": 0, "totalElements": 0, "totalPages": 0 } }\
            """;
    private static final String ID = "지원서 id. `0`이면 404(뼈대 서버)";

    /** 4.6 목 예시: 지원서 id → 그 지원서로 본 면접 id(SessionExamples). 그 밖의 지원서는 빈 목록 */
    private static final Map<Long, Set<Long>> SESSIONS_BY_APPLICATION =
            Map.of(12L, Set.of(55L, 52L), 9L, Set.of(54L, 53L));

    private final Stub stub;
    private final List<SessionListItem> sessions;

    public ApplicationController(Stub stub) {
        this.stub = stub;
        this.sessions = stub.read(SessionExamples.ITEMS, new TypeReference<>() {});
    }

    @Operation(
            summary = "4.1 지원서 작성",
            description =
                    "지원서를 저장한다. 저장한 지원서는 여러 면접에 쓸 수 있다. 자기소개서는 문항 1~5개(문항 질문 1~255자, 답변"
                        + " 1~20,000자)이고 적은 순서가 문항 순서다. 저장 전에 자기소개서로 면접 질문을 만들 수 있는지 판단해, 만들 수 없으면"
                        + " 400(coverLetterItems), 판단하지 못하면 503이다.")
    @ApiResponse(
            responseCode = "201",
            content = @Content(examples = @ExampleObject(value = CREATED)))
    @ApiResponse(
            responseCode = "400",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "COVER_LETTER_UNUSABLE",
                                            value = ErrorExamples.COVER_LETTER_UNUSABLE)))
    @ApiResponse(
            responseCode = "503",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "COVER_LETTER_CHECK_UNAVAILABLE",
                                            value = ErrorExamples.COVER_LETTER_CHECK_UNAVAILABLE)))
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApplicationResponse create(@Valid @RequestBody ApplicationCreateRequest request) {
        return stub.read(CREATED, ApplicationResponse.class);
    }

    @Operation(
            summary = "4.2 지원서 조회",
            description =
                    "자기소개서 문항을 문항 순서대로 준다. 목 예시: 12는 ○○전자, 9는 △△소프트 지원서다(둘 다 면접에 쓴 지원서, 4.6)."
                            + " 0은 404이고, 그 밖의 id는 ○○전자 예시 본문(id 12)을 그대로 준다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "○○전자", value = APPLICATION),
                                @ExampleObject(name = "△△소프트", value = USED_APPLICATION)
                            }))
    @ApiResponse(
            responseCode = "404",
            description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서 · 지운 지원서",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "APPLICATION_NOT_FOUND",
                                            value = ErrorExamples.APPLICATION_NOT_FOUND)))
    @GetMapping("/{applicationId}")
    public ApplicationResponse get(
            @Parameter(description = ID, example = "12") @PathVariable long applicationId) {
        Stub.notFoundIfZero(applicationId, ErrorCode.APPLICATION_NOT_FOUND);
        return stub.read(
                applicationId == 9 ? USED_APPLICATION : APPLICATION, ApplicationResponse.class);
    }

    @Operation(
            summary = "4.3 지원서 목록",
            description =
                    "최근에 작성한 순으로 준다. 지운 지원서는 빠진다. 자기소개서 문항은 빠져 있다(4.2로 조회). 범위를 넘는 페이지도 빈 목록과"
                            + " 실제 전체 건수를 준다.")
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
        List<ApplicationListItem> slice =
                items.stream().skip((long) page * size).limit(size).toList();
        return new PagedModel<>(new PageImpl<>(slice, PageRequest.of(page, size), items.size()));
    }

    @Operation(
            summary = "4.5 지원서 삭제",
            description =
                    "지원서를 삭제한다. 면접에 쓴 지원서도 삭제할 수 있고, 그 지원서로 본 면접 기록은 남는다. 지운 지원서는 4.2 · 4.3 · 4.6 ·"
                            + " 5.1에서 없는 지원서로 다룬다. 이미 지운 지원서는 404다.")
    @ApiResponse(responseCode = "204")
    @ApiResponse(
            responseCode = "404",
            description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서 · 이미 지운 지원서",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "APPLICATION_NOT_FOUND",
                                            value = ErrorExamples.APPLICATION_NOT_FOUND)))
    @DeleteMapping("/{applicationId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(
            @Parameter(description = ID, example = "12") @PathVariable long applicationId) {
        Stub.notFoundIfZero(applicationId, ErrorCode.APPLICATION_NOT_FOUND);
    }

    @Operation(
            summary = "4.6 지원서의 연습 면접 목록",
            description =
                    "이 지원서로 본 연습 면접을 시작 시각·id 내림차순으로 준다. 5.13과 같이 본인의 답변 1개 이상인"
                        + " ANALYZING·COMPLETED·FAILED만 포함하고, 항목 모양도 5.13과 같다. 범위를 넘는 페이지도 빈 목록과 실제"
                        + " 전체 건수를 준다. 목 예시: 12는 2건(완료), 9는 2건(분석 중·실패), 그 밖은 빈 목록이다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "분석 중·실패", value = SESSIONS),
                                @ExampleObject(name = "면접 없음", value = NO_SESSIONS)
                            }))
    @ApiResponse(
            responseCode = "400",
            description = "VALIDATION_FAILED: 음수 페이지 · size 범위 오류",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "VALIDATION_FAILED",
                                            value = ErrorExamples.PAGE_SIZE_INVALID)))
    @ApiResponse(
            responseCode = "404",
            description = "APPLICATION_NOT_FOUND: 없거나 남의 지원서 · 지운 지원서",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "APPLICATION_NOT_FOUND",
                                            value = ErrorExamples.APPLICATION_NOT_FOUND)))
    @ApiResponse(
            responseCode = "500",
            description = "INTERNAL_ERROR: 완료 면접인데 기준별 평가 4개가 모두 저장되지 않음(5.13과 같음)",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "INTERNAL_ERROR",
                                            value = ErrorExamples.INTERNAL_ERROR)))
    @GetMapping("/{applicationId}/interview-sessions")
    public PagedModel<SessionListItem> sessions(
            @Parameter(description = ID, example = "9") @PathVariable long applicationId,
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "10")
                    @RequestParam(defaultValue = "10")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        Stub.notFoundIfZero(applicationId, ErrorCode.APPLICATION_NOT_FOUND);
        Set<Long> ids = SESSIONS_BY_APPLICATION.getOrDefault(applicationId, Set.of());
        List<SessionListItem> mine =
                sessions.stream().filter(item -> ids.contains(item.id())).toList();
        List<SessionListItem> slice = mine.stream().skip((long) page * size).limit(size).toList();
        return new PagedModel<>(new PageImpl<>(slice, PageRequest.of(page, size), mine.size()));
    }
}
