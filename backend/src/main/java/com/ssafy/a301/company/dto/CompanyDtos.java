package com.ssafy.a301.company.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;

public final class CompanyDtos {

    private CompanyDtos() {}

    @Schema(description = "회사 하나(ERD companies · company_aliases)")
    public record CompanyItem(
            @Schema(description = "회사 id", example = "2") long id,
            @Schema(description = "회사명", example = "NAVER") String name,
            @Schema(
                            description = "회사를 찾는 다른 이름. 띄어쓰기·(주) 등을 빼고 소문자로 맞춘 값이다",
                            example = "[\"naver\", \"네이버\"]")
                    List<String> aliases) {}

    public record CompanyListResponse(
            @Schema(description = "회사 전체. 영문 다음 한글 가나다순이고 페이지 없음") List<CompanyItem> content) {}
}
