package com.ssafy.a301.company.repository;

import com.ssafy.a301.company.domain.Company;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CompanyRepository extends JpaRepository<Company, Long> {
    Optional<Company> findByCorpCode(String corpCode);
}
