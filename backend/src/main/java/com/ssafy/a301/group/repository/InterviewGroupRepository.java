package com.ssafy.a301.group.repository;

import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import jakarta.persistence.LockModeType;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InterviewGroupRepository extends JpaRepository<InterviewGroup, Long> {

    boolean existsByInviteCodeAndStatus(String inviteCode, GroupStatus status);

    /** 10.2 · 10.3. 대기 중인 그룹만 초대 코드로 찾는다(초대 확인 응답에 방장 닉네임이 필요하다) */
    @Query(
            "select g from InterviewGroup g join fetch g.host"
                    + " where g.inviteCode = :inviteCode and g.status = :status")
    Optional<InterviewGroup> findByInviteCodeAndStatus(
            @Param("inviteCode") String inviteCode, @Param("status") GroupStatus status);

    /** 10.3. 잠그기 전에 id만 찾는다(먼저 읽어 두면 잠근 뒤에도 읽어 둔 상태를 볼 수 있다) */
    @Query(
            "select g.id from InterviewGroup g where g.inviteCode = :inviteCode and g.status ="
                    + " :status")
    Optional<Long> findIdByInviteCodeAndStatus(
            @Param("inviteCode") String inviteCode, @Param("status") GroupStatus status);

    /** 그룹 상태 · 참가자를 바꿀 때 쓴다(SELECT … FOR UPDATE). 잠금 순서는 회원 → 그룹 → 지원서 · 면접(docs/그룹면접-설계.md 9장) */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select g from InterviewGroup g where g.id = :id")
    Optional<InterviewGroup> findByIdForUpdate(@Param("id") long id);

    /** 안전장치(docs/그룹면접-설계.md 6.11) 후보. 잠근 뒤 방식별 시간으로 다시 확인한다 */
    @Query(
            "select g.id from InterviewGroup g where g.status = :status"
                    + " and g.startedAt <= :startedBefore and g.progressedAt <= :progressedBefore")
    List<Long> findStalledIds(
            @Param("status") GroupStatus status,
            @Param("startedBefore") OffsetDateTime startedBefore,
            @Param("progressedBefore") OffsetDateTime progressedBefore);
}
