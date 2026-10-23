package com.ssafy.a301.home.repository;

import com.ssafy.a301.home.domain.PracticeLog;
import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PracticeLogRepository extends JpaRepository<PracticeLog, Long> {
    @Query("select p.practiceDate from PracticeLog p where p.user.id = :userId")
    List<LocalDate> findPracticeDatesByUserId(@Param("userId") long userId);

    /** 3.3 연습 달력. 한 달 범위의 연습한 날, 날짜 오름차순 */
    @Query(
            """
            select p from PracticeLog p
            where p.user.id = :userId
              and p.user.deletedAt is null
              and p.practiceDate >= :from
              and p.practiceDate < :to
            order by p.practiceDate
            """)
    List<PracticeLog> findInRange(
            @Param("userId") long userId, @Param("from") LocalDate from, @Param("to") LocalDate to);

    /**
     * 그날 처음일 때만 연습 기록을 남긴다(5.8). 남겼으면 1, 이미 있으면 0. 제약 위반 예외를 잡으면 PostgreSQL은 트랜잭션 전체가 실패하므로 ON
     * CONFLICT로 넣는다(BE 설계 5.4).
     */
    @Modifying
    @Query(
            value =
                    "INSERT INTO practice_logs (user_id, practice_date, created_at)"
                            + " VALUES (:userId, :practiceDate, now())"
                            + " ON CONFLICT (user_id, practice_date) DO NOTHING",
            nativeQuery = true)
    int insertIfAbsent(@Param("userId") long userId, @Param("practiceDate") LocalDate practiceDate);
}
