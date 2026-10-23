package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionStatus;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
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

    long countByStatus(SessionStatus status);

    interface PracticeDateCount {
        LocalDate getPracticeDate();

        long getInterviewCount();
    }

    @Query(
            value =
                    """
                    select cast(s.started_at at time zone 'Asia/Seoul' as date) as "practiceDate",
                           count(*) as "interviewCount"
                    from interview_sessions s
                    join users u on u.id = s.user_id
                    where s.user_id = :userId and u.deleted_at is null
                      and s.status in ('ANALYZING', 'COMPLETED', 'FAILED')
                      and s.started_at >= :from and s.started_at < :to
                      and exists (
                          select 1 from answers a
                          join interview_questions q on q.id = a.question_id
                          where q.session_id = s.id
                      )
                    group by cast(s.started_at at time zone 'Asia/Seoul' as date)
                    """,
            nativeQuery = true)
    List<PracticeDateCount> countPracticeByDate(
            @Param("userId") long userId,
            @Param("from") OffsetDateTime from,
            @Param("to") OffsetDateTime to);

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

    /** AI 결과를 저장할 때 쓴다(회원 요청이 아니라 회원 id가 없음). 요청 처리(5.7·5.8)와 겹쳐도 면접 상태를 한 번에 하나씩 바꾼다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select s from InterviewSession s where s.id = :id")
    Optional<InterviewSession> findByIdForUpdate(@Param("id") long id);
}
