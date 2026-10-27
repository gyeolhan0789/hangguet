package com.ssafy.a301.admin.controller;

import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeGrantRequest;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeGrantResponse;
import com.ssafy.a301.admin.service.StreakFreezeGrantService;
import com.ssafy.a301.common.web.CurrentAdminId;
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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/admin")
public class AdminStreakFreezeController {
    private final StreakFreezeGrantService service;

    public AdminStreakFreezeController(StreakFreezeGrantService service) {
        this.service = service;
    }

    @Operation(summary = "8.10 유지권 배포 목록", description = "배포를 최근에 등록한 순으로 준다.")
    @ApiResponse(responseCode = "200", description = "항상. 없으면 빈 목록")
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
        return service.list(page, size);
    }

    @Operation(
            summary = "8.11 유지권 배포",
            description =
                    "유지권을 배포한다. 지급 날짜(한국 시간)에 대상 회원마다 유지권을 개수만큼 만든다(오늘이거나 지났으면 바로)."
                            + " 유지권은 메울 수 있는 날짜만 연습한 날로 메울 수 있고, 지급 날짜부터 2주 동안 쓸 수 있다."
                            + " 전체 회원 배포는 지급할 때 공지를 함께 만든다. 배포는 취소할 수 없다.")
    @ApiResponse(responseCode = "201", description = "배포")
    @ApiResponse(responseCode = "404", description = "USER_NOT_FOUND: 없거나 탈퇴한 지정 회원")
    @PostMapping("/streak-freeze-grants")
    @ResponseStatus(HttpStatus.CREATED)
    public StreakFreezeGrantResponse grant(
            @CurrentAdminId long adminId, @Valid @RequestBody StreakFreezeGrantRequest request) {
        return service.grant(adminId, request);
    }
}
