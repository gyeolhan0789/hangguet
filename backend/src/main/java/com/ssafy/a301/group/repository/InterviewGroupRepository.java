package com.ssafy.a301.group.repository;

import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import jakarta.persistence.LockModeType;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

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

    /** 마감 처리기(docs/그룹면접-설계.md 6.11) 후보: 단계 기한이 지난 진행 중 그룹. 잠근 뒤 기한을 다시 확인한다 */
    @Query(
            "select g.id from InterviewGroup g where g.status ="
                + " com.ssafy.a301.group.domain.GroupStatus.IN_PROGRESS and g.phaseDueAt <= :now")
    List<Long> findDueIds(@Param("now") OffsetDateTime now);

    /** 면접방 참가자를 LiveKit과 맞출 진행 중 그룹(6.9). 막 시작한 그룹은 아직 들어오는 중이라 뺀다 */
    @Query(
            "select g.id from InterviewGroup g where g.status ="
                + " com.ssafy.a301.group.domain.GroupStatus.IN_PROGRESS and g.startedAt <= :before")
    List<Long> findInProgressIdsStartedBefore(@Param("before") OffsetDateTime before);

    /** 면접방 정보를 아직 반영하지 못한 진행 중 그룹(6.5 재동기화) */
    @Query(
            "select g.id from InterviewGroup g where g.status ="
                    + " com.ssafy.a301.group.domain.GroupStatus.IN_PROGRESS and g.roomVersion <"
                    + " g.turnVersion")
    List<Long> findUnsyncedIds();

    /** 꼬리질문 판단 중인데 채팅 최종 답변을 에이전트에 아직 전하지 못한 그룹(6.14) */
    @Query(
            "select g.id from InterviewGroup g where g.status ="
                + " com.ssafy.a301.group.domain.GroupStatus.IN_PROGRESS and g.phase ="
                + " com.ssafy.a301.group.domain.GroupPhase.DECIDING and g.mode ="
                + " com.ssafy.a301.interview.domain.InterviewMode.CHAT and g.answerSentVersion <"
                + " g.turnStartedVersion")
    List<Long> findAnswerUnsentIds();

    /**
     * 커밋 뒤 면접방 정보를 보냈다. 보낸 버전이 지금 버전이면 남긴다. 그 사이 차례가 바뀌었으면 더 새 정보를 먼저 보내고 이 정보가 덮어썼을 수 있어, 남긴 버전을
     * 낮춰 마감 처리기가 지금 정보를 다시 보내게 한다. 커밋 뒤 콜백(afterCommit)에서도 부르므로 새 트랜잭션으로 쓴다
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @Modifying
    @Query(
            value =
                    "UPDATE interview_groups SET room_version = CASE WHEN turn_version = :version"
                            + " THEN GREATEST(room_version, :version) ELSE LEAST(room_version,"
                            + " :version) END WHERE id = :id",
            nativeQuery = true)
    int markRoomVersion(@Param("id") long id, @Param("version") int version);

    /** 커밋 뒤 채팅 최종 답변을 에이전트에 전했다. markRoomVersion과 같이 새 트랜잭션으로 쓴다 */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    @Modifying
    @Query(
            value =
                    "UPDATE interview_groups SET answer_sent_version = :version WHERE id = :id AND"
                            + " answer_sent_version < :version",
            nativeQuery = true)
    int markAnswerSent(@Param("id") long id, @Param("version") int version);

    /** 안전장치(docs/그룹면접-설계.md 6.11) 후보. 잠근 뒤 방식별 시간으로 다시 확인한다 */
    @Query(
            "select g.id from InterviewGroup g where g.status = :status"
                    + " and g.startedAt <= :startedBefore and g.progressedAt <= :progressedBefore")
    List<Long> findStalledIds(
            @Param("status") GroupStatus status,
            @Param("startedBefore") OffsetDateTime startedBefore,
            @Param("progressedBefore") OffsetDateTime progressedBefore);
}
