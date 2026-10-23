package com.ssafy.a301.admin.repository;

import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.domain.StreakFreezeStatus;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.SessionStatus;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/**
 * 관리 페이지 홈 집계(8.15). 새 테이블 없이 기존 테이블을 JPQL로 센다. 다른 모듈의 리포지토리는 쓰지 않는다. 회원 수만 탈퇴한 회원을 빼고, 연습·면접·점수
 * 기록은 탈퇴한 회원의 것도 센다.
 */
public interface AdminMetricsRepository extends Repository<Admin, Long> {

    interface UserCounts {
        long getTotal();

        long getJoinedToday();
    }

    interface DailyCount {
        LocalDate getDate();

        long getUsers();
    }

    interface InterviewCount {
        SessionStatus getStatus();

        InterviewMode getMode();

        long getCount();
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
            select count(u) as total,
                   coalesce(sum(case when u.createdAt >= :todayStart then 1 else 0 end), 0)
                       as joinedToday
            from User u
            where u.deletedAt is null
            """)
    UserCounts countUsers(@Param("todayStart") OffsetDateTime todayStart);

    /** 날짜별 연습한 회원 수. 연습 기록이 없는 날은 빠진다(서비스가 0으로 채움) */
    @Query(
            """
            select p.practiceDate as date, count(p) as users
            from PracticeLog p
            where p.practiceDate between :from and :to
            group by p.practiceDate
            """)
    List<DailyCount> countPracticeByDate(@Param("from") LocalDate from, @Param("to") LocalDate to);

    /** 상태·방식별 면접 수. 연습 면접(분석 중·완료·실패)은 답변이 1개 이상인 것만, 답변 없이 끝난 면접은 그대로 센다 */
    @Query(
            """
            select s.status as status, s.mode as mode, count(s) as count
            from InterviewSession s
            where s.status = :aborted
               or (s.status in :practiced
                   and exists (select a.id from Answer a where a.question.session = s))
            group by s.status, s.mode
            """)
    List<InterviewCount> countInterviews(
            @Param("practiced") Collection<SessionStatus> practiced,
            @Param("aborted") SessionStatus aborted);

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
