package com.ssafy.a301.company.repository;

import com.ssafy.a301.company.domain.CompanyAlias;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CompanyAliasRepository extends JpaRepository<CompanyAlias, Long> {
    List<CompanyAlias> findByCompanyId(long companyId);

    boolean existsByAlias(String alias);
}
