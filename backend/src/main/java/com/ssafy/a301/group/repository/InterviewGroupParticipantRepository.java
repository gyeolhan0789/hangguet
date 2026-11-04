package com.ssafy.a301.group.repository;

import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.interview.domain.SessionStatus;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** 나간 참가자(left_at)와 탈퇴한 회원은 그룹 응답 · 인원 · 방장 넘기기에서 뺀다(탈퇴하면 그룹에서 나간 것과 같다). */
public interface InterviewGroupParticipantRepository
        extends JpaRepository<InterviewGroupParticipant, Long> {

    /** 나가지 않은 참가자를 들어온 순서로. 응답에 쓸 회원 · 면접을 함께 가져온다 */
    @Query(
            "select p from InterviewGroupParticipant p join fetch p.user join fetch p.session where"
                + " p.group.id = :groupId and p.leftAt is null and p.user.deletedAt is null order"
                + " by p.joinedAt, p.id")
    List<InterviewGroupParticipant> findActiveByGroupId(@Param("groupId") long groupId);

    @Query(
            "select count(p) from InterviewGroupParticipant p where p.group.id = :groupId and"
                    + " p.leftAt is null and p.user.deletedAt is null")
    long countActiveByGroupId(@Param("groupId") long groupId);

    /**
     * 회원이 지금 참가 중인 그룹 id. 대기 · 진행 · 시작 실패 그룹에서 나가지 않았고 자기 면접이 아직 끝나지 않은 경우다(docs/그룹면접-설계.md 4.2).
     * 자기 면접을 끝냈으면 그룹이 진행 중이어도 다른 그룹에 들어갈 수 있다.
     */
    @Query(
            "select p.group.id from InterviewGroupParticipant p where p.user.id = :userId and"
                + " p.leftAt is null and p.group.status in :groupStatuses and p.session.status in"
                + " :sessionStatuses")
    List<Long> findCurrentGroupIds(
            @Param("userId") long userId,
            @Param("groupStatuses") Collection<GroupStatus> groupStatuses,
            @Param("sessionStatuses") Collection<SessionStatus> sessionStatuses);
}
