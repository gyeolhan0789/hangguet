package com.ssafy.a301.alarm.repository;

import com.ssafy.a301.alarm.domain.PracticeAlarm;
import jakarta.persistence.LockModeType;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PracticeAlarmRepository extends JpaRepository<PracticeAlarm, Long> {
    /** 행이 없을 때만 기본 시각으로 만든다. 겹친 요청도 실패하지 않도록 ON CONFLICT로 넣는다(연습 기록과 같음) */
    @Modifying
    @Query(
            value =
                    "INSERT INTO practice_alarms (user_id, alarm_time, created_at, updated_at)"
                            + " VALUES (:userId, :time, now(), now())"
                            + " ON CONFLICT (user_id) DO NOTHING",
            nativeQuery = true)
    int insertIfAbsent(@Param("userId") long userId, @Param("time") LocalTime time);

    /** 켜기 · 끄기 · 시각 변경 · 토큰 갱신이 겹쳐도 서로 덮어쓰지 않게 잠근다 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from PracticeAlarm a where a.userId = :userId")
    Optional<PracticeAlarm> findForUpdate(@Param("userId") long userId);

    /** 알림 시각이 from ~ to(분, 둘 다 포함)인 보낼 회원. 켜져 있고, 탈퇴하지 않았고, 오늘 보내지 않았고, 오늘 연습하지 않은 회원 */
    @Query(
            """
            select a.userId from PracticeAlarm a, User u
            where u.id = a.userId
              and u.deletedAt is null
              and a.kakaoRefreshToken is not null
              and a.alarmTime between :from and :to
              and (a.lastSentOn is null or a.lastSentOn < :today)
              and not exists (
                select 1 from PracticeLog p where p.user.id = a.userId and p.practiceDate = :today)
            """)
    List<Long> findDueUserIds(
            @Param("from") LocalTime from,
            @Param("to") LocalTime to,
            @Param("today") LocalDate today);

    /** 오늘 보낼 차례를 가져간다. 가져갔으면 1, 이미 오늘 보냈으면 0 */
    @Modifying
    @Query(
            """
            update PracticeAlarm a set a.lastSentOn = :today
            where a.userId = :userId and (a.lastSentOn is null or a.lastSentOn < :today)
            """)
    int claimToday(@Param("userId") long userId, @Param("today") LocalDate today);

    /** 리프레시 토큰이 before 전에 만료되는 켜진 알림 */
    @Query(
            "select a.userId from PracticeAlarm a where a.kakaoRefreshToken is not null"
                    + " and a.kakaoRefreshExpiresAt < :before")
    List<Long> findRefreshDueUserIds(@Param("before") OffsetDateTime before);

    /** 탈퇴(2.7). 회원 행을 잠근 트랜잭션 안에서 부른다 */
    @Modifying
    @Query("delete from PracticeAlarm a where a.userId = :userId")
    int deleteByUserId(@Param("userId") long userId);
}
