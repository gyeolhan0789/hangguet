package com.ssafy.a301.application.repository;

import com.ssafy.a301.application.domain.Application;
import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 조회 조건에 항상 회원 id를 넣어 "없음"과 "남의 것"을 같은 결과로 만든다(BE 설계 3장). */
public interface ApplicationRepository extends JpaRepository<Application, Long> {
    Optional<Application> findByIdAndUserId(Long id, Long userId);

    Page<Application> findByUserId(Long userId, Pageable pageable);

    /** 수정·삭제할 때 쓴다(SELECT … FOR UPDATE). 면접 만들기(5.1)도 이 행을 잠그면 "사용 중" 확인과 겹치지 않는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from Application a where a.id = :id and a.user.id = :userId")
    Optional<Application> findForUpdate(@Param("id") long id, @Param("userId") long userId);

    /** inUse: 그 지원서를 쓴 면접이 있는지(BE 설계 6.3) */
    @Query("select count(s) > 0 from InterviewSession s where s.application.id = :applicationId")
    boolean isInUse(@Param("applicationId") long applicationId);

    /** 목록의 inUse를 한 번에 구한다. 주어진 지원서 중 면접에 쓴 것의 id */
    @Query(
            "select distinct s.application.id from InterviewSession s"
                    + " where s.application.id in :applicationIds")
    List<Long> findIdsInUse(@Param("applicationIds") Collection<Long> applicationIds);
}
