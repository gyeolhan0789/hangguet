package com.ssafy.a301.application.repository;

import com.ssafy.a301.application.domain.ApplicationClaim;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** 지원서 주장(BE 설계 3장). 지원서마다 한 번 저장하고 바꾸지 않는다. */
public interface ApplicationClaimRepository extends JpaRepository<ApplicationClaim, Long> {

    boolean existsByApplicationId(long applicationId);

    /** 저장한 순서(AI가 보낸 순서)대로 */
    List<ApplicationClaim> findByApplicationIdOrderById(long applicationId);
}
