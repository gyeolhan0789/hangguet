package com.ssafy.a301.admin.repository;

import com.ssafy.a301.admin.domain.StreakFreezeGrantTarget;
import com.ssafy.a301.admin.repository.StreakFreezeRepository.GrantCount;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StreakFreezeGrantTargetRepository
        extends JpaRepository<StreakFreezeGrantTarget, Long> {
    /** 지급 전 지정 회원 배포의 받을 회원 수(8.10) */
    @Query(
            """
            select t.grant.id as grantId, count(t) as count
            from StreakFreezeGrantTarget t
            where t.grant.id in :grantIds
            group by t.grant.id
            """)
    List<GrantCount> countByGrantIds(@Param("grantIds") Collection<Long> grantIds);
}
