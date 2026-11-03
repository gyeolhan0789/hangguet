package com.ssafy.a301.company.controller;

import com.ssafy.a301.company.dto.CompanyDtos.CompanyListResponse;
import com.ssafy.a301.company.service.CompanyService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "4. 지원서")
@RestController
public class CompanyController {
    private final CompanyService service;

    public CompanyController(CompanyService service) {
        this.service = service;
    }

    @Operation(
            summary = "4.7 회사 목록",
            description =
                    "지원서 쓰기의 회사명 자동 완성에 쓰는 회사 전체. 영문 다음 한글 가나다순이고 페이지는 없다. 화면은 입력한 글을 별칭과"
                            + " 같은 규칙(띄어쓰기·(주) 등 빼기, 소문자)으로 맞춰 회사명이나 별칭에 든 회사를 보여 준다. 목록에 없는 회사도"
                            + " 지원서에 쓸 수 있다.")
    @ApiResponse(responseCode = "200", description = "항상. 회사가 없으면 빈 목록")
    @GetMapping("/api/v1/companies")
    public CompanyListResponse list() {
        return service.list();
    }
}
