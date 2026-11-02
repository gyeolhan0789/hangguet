package com.ssafy.a301.company.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.ssafy.a301.company.domain.Company;
import com.ssafy.a301.company.domain.CompanyAlias;
import com.ssafy.a301.company.domain.CompanyCard;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

/** 지원서 회사명으로 최신 카드를 찾는지 실제 PostgreSQL로 확인한다(docs/ERD-회사카드.md 회사 매칭 규칙). 고유번호는 9로 시작한다 */
@SpringBootTest
@Transactional
class CompanyCardFinderTest {
    private static final String HASH_V1 = "1".repeat(64);
    private static final String HASH_V2 = "2".repeat(64);

    @Autowired private CompanyCardFinder finder;
    @Autowired private EntityManager em;

    // 기준: ERD 회사 매칭 규칙의 예시(파이프라인 candidates.key와 같은 결과)
    @Test
    void normalizeFollowsPipelineKey() {
        assertThat(CompanyCardFinder.normalize("삼성 SDS")).isEqualTo("삼성sds");
        assertThat(CompanyCardFinder.normalize("(주)카카오")).isEqualTo("카카오");
        assertThat(CompanyCardFinder.normalize("Samsung SDS Co., Ltd.")).isEqualTo("samsungsds");
        assertThat(CompanyCardFinder.normalize("㈜ 엘지·씨엔에스")).isEqualTo("엘지씨엔에스");
        assertThat(CompanyCardFinder.normalize("주식회사 네이버")).isEqualTo("네이버");
        assertThat(CompanyCardFinder.normalize("Naver Corporation")).isEqualTo("naver");
        assertThat(CompanyCardFinder.normalize("Coupang, Inc.")).isEqualTo("coupang");
        assertThat(CompanyCardFinder.normalize("SK-Hynix")).isEqualTo("skhynix");
        // 전각 공백도 파이썬 \s처럼 지운다
        assertThat(CompanyCardFinder.normalize("현대　자동차")).isEqualTo("현대자동차");
    }

    @Test
    void findsCurrentCardByNormalizedName() {
        Company company = company("99000201", "테스트에이삼공일");
        alias(company, "테스트에이삼공일");
        card(company, "v1", HASH_V1).retire();
        em.flush();
        CompanyCard current = card(company, "v2", HASH_V2);
        em.flush();

        assertThat(finder.findCurrent("(주) 테스트 에이삼공일")).contains(current);
        assertThat(finder.findCurrent("테스트에이삼공일 주식회사")).contains(current);
    }

    @Test
    void emptyWhenCompanyOrCardIsMissing() {
        Company noCard = company("99000202", "카드없는회사");
        alias(noCard, "카드없는회사");
        em.flush();

        assertThat(finder.findCurrent("카드없는회사")).isEmpty();
        assertThat(finder.findCurrent("없는회사에이삼공일")).isEmpty();
        // 지울 글자만 있으면 찾지 않는다
        assertThat(finder.findCurrent("(주)")).isEmpty();
    }

    private Company company(String corpCode, String name) {
        Company company = new Company(corpCode, name, true);
        em.persist(company);
        return company;
    }

    private void alias(Company company, String alias) {
        em.persist(new CompanyAlias(company, alias));
    }

    private CompanyCard card(Company company, String version, String hash) {
        CompanyCard card =
                new CompanyCard(
                        company, Map.of("name", version), hash, LocalDate.parse("2026-10-30"));
        em.persist(card);
        return card;
    }
}
