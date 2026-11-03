package com.ssafy.a301.company;

import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.hasSize;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.company.domain.Company;
import com.ssafy.a301.company.domain.CompanyAlias;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

/**
 * 4.7 회사 목록. DB에 적재된 회사가 있을 수 있어 이 테스트가 넣은 회사(이름 끝 '테스트363', 고유번호 9로 시작)만 골라 확인한다. 로컬은 docker
 * compose의 PostgreSQL이 필요하다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CompanyListIntegrationTest {
    private static final String MINE = "$.content[?(@.name =~ /.*테스트363$/)]";

    @Autowired private MockMvc mvc;
    @Autowired private EntityManager em;

    @Test
    void listsEnglishNamesBeforeKoreanInKoreanOrderWithAliases() throws Exception {
        company("99036301", "하테스트363");
        Company gana = company("99036302", "가나테스트363", "가나테스트363", "ganatest363");
        company("99036303", "zz테스트363");
        company("99036304", "Abc테스트363");
        em.flush();

        mvc.perform(get("/api/v1/companies").with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath(MINE + ".name")
                                .value(contains("Abc테스트363", "zz테스트363", "가나테스트363", "하테스트363")))
                .andExpect(
                        jsonPath(MINE + "[?(@.id == " + gana.getId() + ")].aliases[*]")
                                .value(contains("가나테스트363", "ganatest363")))
                // 별칭이 없어도 null이 아니라 빈 배열이다
                .andExpect(
                        jsonPath("$.content[?(@.name == '하테스트363' && @.aliases empty true)]")
                                .value(hasSize(1)));
    }

    @Test
    void needsLogin() throws Exception {
        mvc.perform(get("/api/v1/companies")).andExpect(status().isUnauthorized());
    }

    private Company company(String corpCode, String name, String... aliases) {
        Company company = new Company(corpCode, name, true);
        em.persist(company);
        for (String alias : aliases) {
            em.persist(new CompanyAlias(company, alias));
        }
        return company;
    }
}
