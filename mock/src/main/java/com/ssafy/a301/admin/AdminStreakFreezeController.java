package com.ssafy.a301.admin;

import com.ssafy.a301.admin.AdminDtos.AdminUserItem;
import com.ssafy.a301.admin.AdminDtos.GrantTarget;
import com.ssafy.a301.admin.AdminDtos.StreakFreezeGrantRequest;
import com.ssafy.a301.admin.AdminDtos.StreakFreezeGrantResponse;
import com.ssafy.a301.common.ErrorExamples;
import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.util.List;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.web.PagedModel;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.type.TypeReference;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/admin")
public class AdminStreakFreezeController {

    private static final String GRANT =
            """
            { "id": 7, "targetType": "USERS", "targetCount": 2, "quantity": 1, "grantDate": "2026-10-30",
              "reason": "10월 점검 보상", "status": "SCHEDULED", "adminName": "운영자",
              "createdAt": "2026-10-23T10:00:00+09:00", "grantedAt": null }\
            """;
    private static final String GRANT_ITEMS =
            """
            [ { "id": 7, "targetType": "USERS", "targetCount": 2, "quantity": 1, "grantDate": "2026-10-30",
                "reason": "10월 점검 보상", "status": "SCHEDULED", "adminName": "운영자",
                "createdAt": "2026-10-23T10:00:00+09:00", "grantedAt": null },
              { "id": 6, "targetType": "ALL", "targetCount": 120, "quantity": 2, "grantDate": "2026-10-20",
                "reason": "채팅 면접 오픈 기념", "status": "GRANTED", "adminName": "운영자",
                "createdAt": "2026-10-19T17:30:00+09:00", "grantedAt": "2026-10-20T00:00:00+09:00" } ]\
            """;
    private static final String GRANT_LIST =
            """
            { "content": [
                { "id": 7, "targetType": "USERS", "targetCount": 2, "quantity": 1, "grantDate": "2026-10-30",
                  "reason": "10월 점검 보상", "status": "SCHEDULED", "adminName": "운영자",
                  "createdAt": "2026-10-23T10:00:00+09:00", "grantedAt": null },
                { "id": 6, "targetType": "ALL", "targetCount": 120, "quantity": 2, "grantDate": "2026-10-20",
                  "reason": "채팅 면접 오픈 기념", "status": "GRANTED", "adminName": "운영자",
                  "createdAt": "2026-10-19T17:30:00+09:00", "grantedAt": "2026-10-20T00:00:00+09:00" } ],
              "page": { "size": 10, "number": 0, "totalElements": 2, "totalPages": 1 } }\
            """;
    private static final String GRANT_REQUEST =
            """
            { "targetType": "USERS", "userIds": [1, 2], "quantity": 1, "grantDate": "2026-10-30",
              "reason": "10월 점검 보상" }\
            """;
    private static final String USER_ITEMS =
            """
            [ { "id": 1, "email": "a@ssafy.com", "nickname": "면접왕", "createdAt": "2026-09-01T10:00:00+09:00" },
              { "id": 2, "email": "b@ssafy.com", "nickname": "스트릭장인", "createdAt": "2026-09-03T21:15:00+09:00" } ]\
            """;
    private static final String USER_LIST =
            """
            { "content": [
                { "id": 1, "email": "a@ssafy.com", "nickname": "면접왕", "createdAt": "2026-09-01T10:00:00+09:00" },
                { "id": 2, "email": "b@ssafy.com", "nickname": "스트릭장인", "createdAt": "2026-09-03T21:15:00+09:00" } ],
              "page": { "size": 10, "number": 0, "totalElements": 2, "totalPages": 1 } }\
            """;

    private final Stub stub;

    public AdminStreakFreezeController(Stub stub) {
        this.stub = stub;
    }

    @Operation(summary = "8.10 유지권 배포 목록", description = "배포를 최근에 등록한 순으로 준다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = GRANT_LIST)))
    @GetMapping("/streak-freeze-grants")
    public PagedModel<StreakFreezeGrantResponse> grants(
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "10")
                    @RequestParam(defaultValue = "10")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        List<StreakFreezeGrantResponse> items = stub.read(GRANT_ITEMS, new TypeReference<>() {});
        return new PagedModel<>(new PageImpl<>(items, PageRequest.of(page, size), items.size()));
    }

    @Operation(
            summary = "8.11 유지권 배포",
            description =
                    "유지권을 배포한다. 대상 회원마다 유지권을 개수만큼 만들고, 지급 날짜(한국 시간)부터 2주 동안 쓸 수 있다."
                            + " 배포는 취소할 수 없다.")
    @io.swagger.v3.oas.annotations.parameters.RequestBody(
            content = @Content(examples = @ExampleObject(value = GRANT_REQUEST)))
    @ApiResponse(responseCode = "201", content = @Content(examples = @ExampleObject(value = GRANT)))
    @ApiResponse(
            responseCode = "404",
            content =
                    @Content(
                            mediaType = ErrorExamples.PROBLEM,
                            examples =
                                    @ExampleObject(
                                            name = "USER_NOT_FOUND",
                                            value = ErrorExamples.USER_NOT_FOUND)))
    @PostMapping("/streak-freeze-grants")
    @ResponseStatus(HttpStatus.CREATED)
    public StreakFreezeGrantResponse grant(@Valid @RequestBody StreakFreezeGrantRequest request) {
        List<Long> userIds = request.userIds() == null ? List.of() : request.userIds();
        if (request.targetType() == GrantTarget.USERS && userIds.isEmpty()) {
            throw new FieldValidationException("userIds", "배포 대상이 USERS면 1명 이상입니다.");
        }
        if (request.targetType() == GrantTarget.ALL && !userIds.isEmpty()) {
            throw new FieldValidationException("userIds", "배포 대상이 ALL이면 보내지 않습니다.");
        }
        // 회원 id 0은 없는 회원으로 본다(화면 오류 처리 확인용)
        if (userIds.contains(0L)) {
            throw new ApiException(ErrorCode.USER_NOT_FOUND);
        }
        return stub.read(GRANT, StreakFreezeGrantResponse.class);
    }

    @Operation(
            summary = "8.12 회원 검색",
            description = "지정 배포 대상을 고를 때 이메일·닉네임에 검색어가 들어간 회원을 준다. 탈퇴한 회원은 빠진다.")
    @ApiResponse(
            responseCode = "200",
            content = @Content(examples = @ExampleObject(value = USER_LIST)))
    @GetMapping("/users")
    public PagedModel<AdminUserItem> users(
            @Parameter(description = "이메일 또는 닉네임 검색어(1~255자)", example = "면접")
                    @RequestParam
                    @Size(min = 1, max = 255, message = "1~255자입니다.")
                    String keyword,
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "10")
                    @RequestParam(defaultValue = "10")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        List<AdminUserItem> items = stub.read(USER_ITEMS, new TypeReference<>() {});
        return new PagedModel<>(new PageImpl<>(items, PageRequest.of(page, size), items.size()));
    }
}
