package com.ssafy.a301.admin.repository;

import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.domain.StreakFreezeStatus;
import com.ssafy.a301.inquiry.domain.InquiryStatus;
import com.ssafy.a301.interview.domain.AiJobType;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.SessionStatus;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * 관리 페이지 홈 집계(8.15). 새 테이블 없이 기존 테이블을 JPQL로 센다(재방문만 네이티브). 다른 모듈의 리포지토리는 쓰지 않는다. 회원 수·첫 면접 회원 수만
 * 탈퇴한 회원을 빼고, 연습·재방문·면접·점수·지원서 기록은 탈퇴한 회원의 것도 센다.
 */
public interface AdminMetricsRepository extends Repository<Admin, Long> {

    interface UserCounts {
        long getTotal();

        long getJoinedToday();

        long getWithdrawn();
    }

    interface RetentionCount {
        long getEligible();

        long getReturned();
    }

    interface DailyCount {
        LocalDate getDate();

        long getUsers();
    }

    interface InterviewCount {
        SessionStatus getStatus();

        InterviewMode getMode();

        Persona getPersona();

        long getCount();
    }

    interface SpeechAverage {
        long getSessions();

        Double getFillerPerMin();

        Double getLongPauseCount();

        Double getSpeedDeviationPct();

        Double getTrailingOffRatio();

        Double getPitchRangeSt();

        Double getGazeRatio();
    }

    interface CriterionScore {
        Criterion getCriterion();

        double getScore();
    }

    interface FreezeCounts {
        long getGranted();

        long getUsed();

        long getExpired();
    }

    interface NoticeReadCount {
        Long getId();

        String getTitle();

        long getReadCount();
    }

    @Query(
            """
            select coalesce(sum(case when u.deletedAt is null then 1 else 0 end), 0) as total,
                   coalesce(sum(case when u.deletedAt is null and u.createdAt >= :dayStart
                                          and u.createdAt < :dayEnd
                                     then 1 else 0 end), 0) as joinedToday,
                   coalesce(sum(case when u.deletedAt is not null then 1 else 0 end), 0)
                       as withdrawn
            from User u
            """)
    UserCounts countUsers(
            @Param("dayStart") OffsetDateTime dayStart, @Param("dayEnd") OffsetDateTime dayEnd);

    /** 탈퇴하지 않은 회원 중 연습 면접(답변 1개 이상, 분석 중·완료·실패)을 한 번 이상 한 회원 수 */
    @Query(
            """
            select count(u)
            from User u
            where u.deletedAt is null
              and exists (select s.id from InterviewSession s
                          where s.user = u and s.status in :practiced
                            and exists (select a.id from Answer a where a.question.session = s))
            """)
    long countInterviewedUsers(@Param("practiced") Collection<SessionStatus> practiced);

    /**
     * 재방문. lastJoinDate(한국 날짜) 이전에 가입한 회원(탈퇴 포함) 중 가입한 날에서 정확히 days일째 되는 날에 연습 기록이 있는 회원 수. 가입 날짜를
     * 한국 시간으로 바꿔야 해서 네이티브 쿼리다
     */
    @Query(
            value =
                    """
                    SELECT count(*) AS eligible,
                           count(*) FILTER (WHERE EXISTS (
                               SELECT 1 FROM practice_logs p
                               WHERE p.user_id = u.id
                                 AND p.practice_date
                                     = CAST(u.created_at AT TIME ZONE 'Asia/Seoul' AS date) + :days
                           )) AS returned
                    FROM users u
                    WHERE CAST(u.created_at AT TIME ZONE 'Asia/Seoul' AS date) <= :lastJoinDate
                    """,
            nativeQuery = true)
    RetentionCount countRetention(
            @Param("days") int days, @Param("lastJoinDate") LocalDate lastJoinDate);

    /** 날짜별 연습한 회원 수. 연습 기록이 없는 날은 빠진다(서비스가 0으로 채움) */
    @Query(
            """
            select p.practiceDate as date, count(p) as users
            from PracticeLog p
            where p.practiceDate between :from and :to
            group by p.practiceDate
            """)
    List<DailyCount> countPracticeByDate(@Param("from") LocalDate from, @Param("to") LocalDate to);

    /** 기간 안에 하루라도 연습한 회원 수 */
    @Query(
            """
            select count(distinct p.user)
            from PracticeLog p
            where p.practiceDate between :from and :to
            """)
    long countPracticedUsers(@Param("from") LocalDate from, @Param("to") LocalDate to);

    /** 상태·방식·면접관별 면접 수. 연습 면접(분석 중·완료·실패)은 답변이 1개 이상인 것만, 답변 없이 끝난 면접은 그대로 센다 */
    @Query(
            """
            select s.status as status, s.mode as mode, s.persona as persona, count(s) as count
            from InterviewSession s
            where s.status = :aborted
               or (s.status in :practiced
                   and exists (select a.id from Answer a where a.question.session = s))
            group by s.status, s.mode, s.persona
            """)
    List<InterviewCount> countInterviews(
            @Param("practiced") Collection<SessionStatus> practiced,
            @Param("aborted") SessionStatus aborted);

    /**
     * 결과를 기다린 지 오래된 면접 수. 분석 중인데 마지막 결과 생성 요청(EVALUATE 작업)이 deadline 이전인 면접. 회원이 상태를 조회해야 FAILED로
     * 바뀌므로 그 전까지 남아 있는 것을 센다
     */
    @Query(
            """
            select count(s)
            from InterviewSession s
            where s.status = :analyzing
              and (select max(j.createdAt) from AiJob j
                   where j.sessionId = s.id and j.jobType = :evaluate) <= :deadline
            """)
    long countStuckAnalyses(
            @Param("analyzing") SessionStatus analyzing,
            @Param("evaluate") AiJobType evaluate,
            @Param("deadline") OffsetDateTime deadline);

    /** 결과가 있는 화상 면접들의 말하기 지표 평균. 값이 없는(null) 지표는 그 지표의 평균에서만 빠진다 */
    @Query(
            """
            select count(m) as sessions,
                   avg(m.fillerPerMin) as fillerPerMin,
                   avg(m.longPauseCount) as longPauseCount,
                   avg(m.speedDeviationPct) as speedDeviationPct,
                   avg(m.trailingOffRatio) as trailingOffRatio,
                   avg(m.pitchRangeSt) as pitchRangeSt,
                   avg(m.gazeRatio) as gazeRatio
            from SpeechMetric m
            where m.session.status = :completed
            """)
    SpeechAverage averageSpeech(@Param("completed") SessionStatus completed);

    @Query("select count(a) from Application a")
    long countApplications();

    @Query("select count(i) from Inquiry i where i.status = :status")
    long countInquiries(@Param("status") InquiryStatus status);

    /** 결과가 있는 면접들의 기준별 평균 점수 */
    @Query(
            """
            select sc.criterion as criterion, avg(sc.score) as score
            from SessionScore sc
            where sc.session.status = :completed
            group by sc.criterion
            """)
    List<CriterionScore> averageScores(@Param("completed") SessionStatus completed);

    /** 지급한 유지권 수와 그중 사용·만료 수. 기간이 지났는데 아직 EXPIRED로 바뀌지 않은 것도 만료로 센다 */
    @Query(
            """
            select count(f) as granted,
                   coalesce(sum(case when f.status = :used then 1 else 0 end), 0) as used,
                   coalesce(sum(case when f.status = :expired
                                       or (f.status = :available and f.expiresAt <= :now)
                                     then 1 else 0 end), 0) as expired
            from StreakFreeze f
            """)
    FreezeCounts countFreezes(
            @Param("available") StreakFreezeStatus available,
            @Param("used") StreakFreezeStatus used,
            @Param("expired") StreakFreezeStatus expired,
            @Param("now") OffsetDateTime now);

    /** 게시 중인 공지별 확인한 회원 수. 최신순 */
    @Query(
            """
            select n.id as id, n.title as title, count(r) as readCount
            from Notice n
            left join NoticeRead r on r.notice = n
            where n.deletedAt is null
              and n.startsAt <= :now
              and (n.endsAt is null or n.endsAt > :now)
            group by n.id, n.title, n.startsAt
            order by n.startsAt desc, n.id desc
            """)
    List<NoticeReadCount> countNoticeReads(@Param("now") OffsetDateTime now);
}
