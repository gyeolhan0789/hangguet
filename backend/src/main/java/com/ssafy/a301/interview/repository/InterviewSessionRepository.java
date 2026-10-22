package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionStatus;
import jakarta.persistence.LockModeType;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InterviewSessionRepository extends JpaRepository<InterviewSession, Long> {
    Optional<InterviewSession> findByIdAndUserId(Long id, Long userId);

    @EntityGraph(attributePaths = "application")
    @Query(
            value =
                    """
                    select s from InterviewSession s
                    where s.user.id = :userId
                      and s.user.deletedAt is null
                      and s.status in :statuses
                      and s.startedAt >= :from
                      and s.startedAt < :to
                      and exists (
                          select a.id from Answer a where a.question.session = s
                      )
                    """,
            countQuery =
                    """
                    select count(s) from InterviewSession s
                    where s.user.id = :userId
                      and s.user.deletedAt is null
                      and s.status in :statuses
                      and s.startedAt >= :from
                      and s.startedAt < :to
                      and exists (
                          select a.id from Answer a where a.question.session = s
                      )
                    """)
    Page<InterviewSession> findPracticeSessions(
            @Param("userId") long userId,
            @Param("statuses") Collection<SessionStatus> statuses,
            @Param("from") OffsetDateTime from,
            @Param("to") OffsetDateTime to,
            Pageable pageable);

    @Query(
            """
            select count(s) from InterviewSession s
            where s.user.id = :userId
              and s.user.deletedAt is null
              and s.status in :statuses
              and s.endedAt is not null
              and exists (
                  select a.id from Answer a where a.question.session = s
              )
            """)
    long countPracticeSessions(
            @Param("userId") long userId, @Param("statuses") Collection<SessionStatus> statuses);

    @Query(
            """
            select s.startedAt, s.endedAt from InterviewSession s
            where s.user.id = :userId
              and s.user.deletedAt is null
              and s.status in :statuses
              and s.startedAt >= :from
              and s.startedAt < :to
              and exists (
                  select a.id from Answer a where a.question.session = s
              )
            """)
    List<Object[]> findPracticeDurations(
            @Param("userId") long userId,
            @Param("statuses") Collection<SessionStatus> statuses,
            @Param("from") OffsetDateTime from,
            @Param("to") OffsetDateTime to);

    /** 응답에 회사명·직무가 필요한 조회. 지원서를 함께 가져온다(BE 설계 3장). */
    @Query(
            "select s from InterviewSession s join fetch s.application"
                    + " where s.id = :id and s.user.id = :userId")
    Optional<InterviewSession> findWithApplication(
            @Param("id") long id, @Param("userId") long userId);

    /** 상태를 바꿀 때 쓴다(SELECT … FOR UPDATE). 같은 면접의 시작·플랜 재생성이 겹쳐도 한 번만 처리된다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query(
            "select s from InterviewSession s join fetch s.application"
                    + " where s.id = :id and s.user.id = :userId")
    Optional<InterviewSession> findForUpdate(@Param("id") long id, @Param("userId") long userId);
}
