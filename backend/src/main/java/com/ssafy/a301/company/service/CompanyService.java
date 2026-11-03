package com.ssafy.a301.company.service;

import static java.util.stream.Collectors.groupingBy;
import static java.util.stream.Collectors.mapping;
import static java.util.stream.Collectors.toList;

import com.ssafy.a301.company.domain.Company;
import com.ssafy.a301.company.domain.CompanyAlias;
import com.ssafy.a301.company.dto.CompanyDtos.CompanyItem;
import com.ssafy.a301.company.dto.CompanyDtos.CompanyListResponse;
import com.ssafy.a301.company.repository.CompanyAliasRepository;
import com.ssafy.a301.company.repository.CompanyRepository;
import java.text.Collator;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 4.7 회사 목록. 지원서 쓰기의 회사명 자동 완성에 쓰도록 회사 전체를 별칭과 함께 준다. */
@Service
public class CompanyService {
    private final CompanyRepository companies;
    private final CompanyAliasRepository aliases;

    public CompanyService(CompanyRepository companies, CompanyAliasRepository aliases) {
        this.companies = companies;
        this.aliases = aliases;
    }

    /** 한국어 정렬이라 영문이 한글보다 먼저 오고 한글은 가나다순이다. 별칭은 적재한 순서다 */
    @Transactional(readOnly = true)
    public CompanyListResponse list() {
        Map<Long, List<String>> aliasesByCompany =
                aliases.findAll(Sort.by("id")).stream()
                        .collect(
                                groupingBy(
                                        alias -> alias.getCompany().getId(),
                                        mapping(CompanyAlias::getAlias, toList())));
        Collator korean = Collator.getInstance(Locale.KOREAN);
        List<CompanyItem> content =
                companies.findAll().stream()
                        .sorted(
                                Comparator.comparing(Company::getName, korean)
                                        .thenComparing(Company::getId))
                        .map(
                                company ->
                                        new CompanyItem(
                                                company.getId(),
                                                company.getName(),
                                                aliasesByCompany.getOrDefault(
                                                        company.getId(), List.of())))
                        .toList();
        return new CompanyListResponse(content);
    }
}
