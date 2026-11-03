package com.ssafy.a301.company;

import com.ssafy.a301.common.Stub;
import com.ssafy.a301.company.CompanyDtos.CompanyListResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "4. 지원서")
@RestController
public class CompanyController {

    static final String COMPANIES =
            """
            { "content": [
                { "id": 2, "name": "NAVER", "aliases": ["naver", "네이버"] },
                { "id": 7, "name": "NC", "aliases": ["nc", "ncsoft", "엔씨소프트"] },
                { "id": 3, "name": "SK하이닉스", "aliases": ["sk하이닉스", "skhynix"] },
                { "id": 1, "name": "삼성전자", "aliases": ["삼성전자", "samsungelectronics"] },
                { "id": 5, "name": "카카오", "aliases": ["카카오", "kakao"] },
                { "id": 4, "name": "현대자동차", "aliases": ["현대자동차", "hyundaimotorcompany"] } ] }\
            """;

    private final Stub stub;

    public CompanyController(Stub stub) {
        this.stub = stub;
    }

    @Operation(
            summary = "4.7 회사 목록",
            description =
                    "지원서 쓰기의 회사명 자동 완성에 쓰는 회사 전체. 영문 다음 한글 가나다순이고 페이지는 없다. 화면은 입력한 글을 별칭과"
                            + " 같은 규칙(띄어쓰기·(주) 등 빼기, 소문자)으로 맞춰 회사명이나 별칭에 든 회사를 보여 준다. 목록에 없는 회사도"
                            + " 지원서에 쓸 수 있다.")
    @ApiResponse(
            responseCode = "200",
            description = "항상. 회사가 없으면 빈 목록",
            content = @Content(examples = @ExampleObject(value = COMPANIES)))
    @GetMapping("/api/v1/companies")
    public CompanyListResponse list() {
        return stub.read(COMPANIES, CompanyListResponse.class);
    }
}
