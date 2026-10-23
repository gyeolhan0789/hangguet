package com.ssafy.a301.admin.repository;

import com.ssafy.a301.admin.domain.GrantStatus;
import com.ssafy.a301.admin.domain.StreakFreezeGrant;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StreakFreezeGrantRepository extends JpaRepository<StreakFreezeGrant, Long> {
    /** 배포 목록(8.10). 응답에 배포한 관리자 이름이 필요해 관리자를 함께 가져온다 */
    @EntityGraph(attributePaths = "admin")
    @Query("select g from StreakFreezeGrant g")
    Page<StreakFreezeGrant> findPage(Pageable pageable);

    /** 지급할 배포(지급 날짜가 오늘이거나 지났고 아직 지급하지 않음). 지급 날짜 순 */
    @Query(
            """
            select g.id from StreakFreezeGrant g
            where g.status = :status and g.grantDate <= :today
            order by g.grantDate, g.id
            """)
    List<Long> findDueIds(@Param("status") GrantStatus status, @Param("today") LocalDate today);

    /** 지급할 때 쓴다(SELECT … FOR UPDATE). 스케줄러와 등록 요청, 여러 서버가 겹쳐도 한 번만 지급한다 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from StreakFreezeGrant g join fetch g.admin where g.id = :id")
    Optional<StreakFreezeGrant> findForUpdate(@Param("id") long id);
}
