package com.ssafy.a301.admin.controller;

import com.ssafy.a301.admin.dto.AdminDtos.AdminUserItem;
import com.ssafy.a301.admin.service.StreakFreezeGrantService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.data.web.PagedModel;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 8.12 관리 페이지의 회원 검색. 지정 회원 배포(8.11)의 대상을 고를 때 쓴다. */
@Tag(name = "8. 관리자")
@RestController
@RequestMapping("/api/v1/admin")
public class AdminUserController {
    private final StreakFreezeGrantService service;

    public AdminUserController(StreakFreezeGrantService service) {
        this.service = service;
    }

    @Operation(
            summary = "8.12 회원 검색",
            description = "지정 배포 대상을 고를 때 이메일·닉네임에 검색어가 들어간 회원을 최근 가입 순으로 준다. 탈퇴한 회원은 빠진다.")
    @GetMapping("/users")
    public PagedModel<AdminUserItem> users(
            @Parameter(description = "이메일 또는 닉네임 검색어(1~255자)", example = "면접")
                    @RequestParam
                    @NotBlank(message = "필수 값입니다.")
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
        return service.searchUsers(keyword, page, size);
    }
}
