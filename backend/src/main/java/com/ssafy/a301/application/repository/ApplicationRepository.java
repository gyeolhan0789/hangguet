package com.ssafy.a301.application.repository;

import com.ssafy.a301.application.domain.Application;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 조회 조건에 항상 회원 id를 넣어 "없음"과 "남의 것"을 같은 결과로 만든다(BE 설계 3장). 지운 지원서(deleted_at)도 없는 지원서와 같이 다룬다. */
public interface ApplicationRepository extends JpaRepository<Application, Long> {

    /** 4.2. 자기소개서 문항을 함께 읽는다. */
    @EntityGraph(attributePaths = "coverLetterItems")
    Optional<Application> findByIdAndUserIdAndDeletedAtIsNull(Long id, Long userId);

    Page<Application> findByUserIdAndDeletedAtIsNull(Long userId, Pageable pageable);

    /** 4.6. 지원서가 있는지만 본다. */
    boolean existsByIdAndUserIdAndDeletedAtIsNull(Long id, Long userId);

    /** 삭제(4.5) · 면접 만들기(5.1)에 쓴다(SELECT … FOR UPDATE). 지우는 중인 지원서로 면접을 만들지 않게 같은 행을 잠근다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select a from Application a"
                    + " where a.id = :id and a.user.id = :userId and a.deletedAt is null")
    Optional<Application> findForUpdate(@Param("id") long id, @Param("userId") long userId);
}
