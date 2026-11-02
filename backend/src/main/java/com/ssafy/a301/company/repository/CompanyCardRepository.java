package com.ssafy.a301.company.repository;

import com.ssafy.a301.company.domain.CompanyCard;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CompanyCardRepository extends JpaRepository<CompanyCard, Long> {
    @Query("select c from CompanyCard c where c.company.id = :companyId and c.current = true")
    Optional<CompanyCard> findCurrent(@Param("companyId") long companyId);

    /** 별칭(정규화한 회사명)이 가리키는 회사의 최신 카드 */
    @Query(
            "select c from CompanyCard c, CompanyAlias a"
                    + " where a.alias = :alias and a.company = c.company and c.current = true")
    Optional<CompanyCard> findCurrentByAlias(@Param("alias") String alias);

    /**
     * 최신이 아니고, 어느 면접도 쓰지 않고, before보다 먼저 넣은 카드를 지운다. 면접이 쓰는 카드는 interview_sessions.company_card_id로
     * 확인한다(company 패키지가 면접 엔티티에 기대지 않도록 네이티브 쿼리).
     */
    @Modifying
    @Query(
            value =
                    "DELETE FROM company_cards c WHERE NOT c.is_current AND c.created_at < :before"
                            + " AND NOT EXISTS (SELECT 1 FROM interview_sessions s"
                            + " WHERE s.company_card_id = c.id)",
            nativeQuery = true)
    int deleteStale(@Param("before") OffsetDateTime before);
}
