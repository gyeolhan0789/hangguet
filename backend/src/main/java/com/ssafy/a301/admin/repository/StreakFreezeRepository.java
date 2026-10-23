package com.ssafy.a301.admin.repository;

import com.ssafy.a301.admin.domain.StreakFreeze;
import com.ssafy.a301.admin.domain.StreakFreezeStatus;
import jakarta.persistence.LockModeType;
import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface StreakFreezeRepository extends JpaRepository<StreakFreeze, Long> {

    /** 배포별 회원 수 집계 결과(8.10 받는 회원 수) */
    interface GrantCount {
        Long getGrantId();

        long getCount();
    }

    /**
     * 배포를 지급한다. 대상 회원(전체면 탈퇴하지 않은 모든 회원, 지정이면 받을 회원 중 탈퇴하지 않은 회원)마다 개수만큼 한 번에 넣고, 넣은 행 수를 준다. JPQL에
     * 없는 generate_series로 개수만큼 늘리므로 native로 쓴다.
     */
    @Modifying
    @Query(
            value =
                    """
                    INSERT INTO streak_freezes
                        (user_id, grant_id, status, granted_at, expires_at, fillable_date)
                    SELECT u.id, g.id, :available, :grantedAt, :expiresAt, g.fillable_date
                    FROM streak_freeze_grants g
                    JOIN users u ON u.deleted_at IS NULL
                     AND (g.target_type = :all
                          OR EXISTS (SELECT 1 FROM streak_freeze_grant_targets t
                                     WHERE t.grant_id = g.id AND t.user_id = u.id))
                    CROSS JOIN generate_series(1, g.quantity)
                    WHERE g.id = :grantId
                    """,
            nativeQuery = true)
    int insertForGrant(
            @Param("grantId") long grantId,
            @Param("available") String available,
            @Param("all") String all,
            @Param("grantedAt") OffsetDateTime grantedAt,
            @Param("expiresAt") OffsetDateTime expiresAt);

    /** 지금 쓸 수 있는 유지권(8.13). 만료가 빠른 순 */
    @Query(
            """
            select f from StreakFreeze f
            where f.user.id = :userId and f.status = :status and f.expiresAt > :now
            order by f.expiresAt, f.id
            """)
    List<StreakFreeze> findUsable(
            @Param("userId") long userId,
            @Param("status") StreakFreezeStatus status,
            @Param("now") OffsetDateTime now);

    @Query(
            """
            select count(f) from StreakFreeze f
            where f.user.id = :userId and f.status = :status and f.expiresAt > :now
            """)
    long countUsable(
            @Param("userId") long userId,
            @Param("status") StreakFreezeStatus status,
            @Param("now") OffsetDateTime now);

    /** 유지권을 쓸 때 쓴다(SELECT … FOR UPDATE). 같은 유지권을 동시에 두 번 쓰지 않는다. 남의 유지권은 비어 있다 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select f from StreakFreeze f where f.id = :id and f.user.id = :userId")
    Optional<StreakFreeze> findForUpdate(@Param("id") long id, @Param("userId") long userId);

    /** 지급한 배포의 받은 회원 수(8.10) */
    @Query(
            """
            select f.grant.id as grantId, count(distinct f.user.id) as count
            from StreakFreeze f
            where f.grant.id in :grantIds
            group by f.grant.id
            """)
    List<GrantCount> countUsersByGrantIds(@Param("grantIds") Collection<Long> grantIds);

    /** 기간이 지난 사용 가능 유지권을 EXPIRED로 바꾼다. 바꾼 수를 준다 */
    @Modifying
    @Query(
            """
            update StreakFreeze f set f.status = :expired
            where f.status = :available and f.expiresAt <= :now
            """)
    int expire(
            @Param("available") StreakFreezeStatus available,
            @Param("expired") StreakFreezeStatus expired,
            @Param("now") OffsetDateTime now);
}
