package com.ssafy.a301.group.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.domain.JobCategory;
import com.ssafy.a301.group.dto.GroupDtos.GroupCreateRequest;
import com.ssafy.a301.group.dto.GroupDtos.GroupJoinRequest;
import com.ssafy.a301.group.dto.GroupDtos.GroupResponse;
import com.ssafy.a301.group.dto.GroupDtos.InviteResponse;
import com.ssafy.a301.group.mapper.GroupMapper;
import com.ssafy.a301.group.repository.GroupPresenceStore;
import com.ssafy.a301.group.repository.InterviewGroupParticipantRepository;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.service.InterviewSessionService;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 10.1~10.6 그룹 만들기 · 초대 확인 · 참가 · 조회 · 준비 · 나가기(docs/그룹면접-설계.md 6.1). 참가자는 나가지 않은 참가자만 보고, 참가자가 아닌
 * 회원에게는 그룹이 없는 것처럼 404를 준다. 그룹 상태 · 참가자를 바꾸는 일은 그룹 행을 잠근 한 트랜잭션에서 하고, 잠근 뒤 DB 값으로 조건을 다시 확인한다. 잠금
 * 순서는 회원 → 그룹 → 지원서 · 면접이다(9장).
 */
@Service
public class InterviewGroupService {
    private static final Logger LOG = LoggerFactory.getLogger(InterviewGroupService.class);
    // 다른 그룹에 참가 중인지 볼 때의 그룹 · 면접 상태(4.2). 자기 면접이 끝났으면 참가 중이 아니다
    private static final Set<GroupStatus> CURRENT_GROUP =
            Set.of(GroupStatus.WAITING, GroupStatus.IN_PROGRESS, GroupStatus.START_FAILED);
    private static final Set<SessionStatus> CURRENT_SESSION =
            Set.of(SessionStatus.READY, SessionStatus.IN_PROGRESS, SessionStatus.START_FAILED);

    private final InterviewGroupRepository groups;
    private final InterviewGroupParticipantRepository participants;
    private final UserRepository users;
    private final InterviewSessionService sessions;
    private final GroupPresenceStore presence;
    private final InviteCodes inviteCodes;
    private final GroupResponses responses;
    private final TransactionTemplate transactions;
    private final Duration waitingExpiry;
    private final Duration hostTimeout;

    public InterviewGroupService(
            InterviewGroupRepository groups,
            InterviewGroupParticipantRepository participants,
            UserRepository users,
            InterviewSessionService sessions,
            GroupPresenceStore presence,
            InviteCodes inviteCodes,
            GroupResponses responses,
            TransactionTemplate transactions,
            @Value("${group.waiting-expiry:1h}") Duration waitingExpiry,
            @Value("${group.lobby-host-timeout:10s}") Duration hostTimeout) {
        this.groups = groups;
        this.participants = participants;
        this.users = users;
        this.sessions = sessions;
        this.presence = presence;
        this.inviteCodes = inviteCodes;
        this.responses = responses;
        this.transactions = transactions;
        this.waitingExpiry = waitingExpiry;
        this.hostTimeout = hostTimeout;
    }

    /** 10.1. 그룹(WAITING, 초대 코드) → 방장 면접(그룹용 PLAN 작업) → 참가자 행을 한 트랜잭션에서 만든다. */
    public GroupResponse create(long userId, GroupCreateRequest request) {
        OffsetDateTime now = OffsetDateTime.now();
        GroupResponse response =
                transactions.execute(
                        status -> {
                            User host = lockUser(userId);
                            requireNotInGroup(userId, now);
                            InterviewGroup group =
                                    groups.save(
                                            new InterviewGroup(
                                                    host,
                                                    request.mode(),
                                                    request.persona(),
                                                    request.jobCategory(),
                                                    request.capacity(),
                                                    inviteCodes.next()));
                            participants.save(
                                    newParticipant(
                                            group,
                                            host,
                                            request.applicationId(),
                                            request.jobCategory(),
                                            now));
                            return response(group, userId, null, now);
                        });
        touch(() -> presence.record(response.groupId(), userId, now.toInstant()));
        return response;
    }

    /** 10.2. 대기 중이고 오래되지 않은 그룹만 보여 준다. 그 밖에는 없는 코드와 같이 404다. */
    public InviteResponse invite(String inviteCode) {
        OffsetDateTime now = OffsetDateTime.now();
        return transactions.execute(
                status -> {
                    InterviewGroup group =
                            groups.findByInviteCodeAndStatus(
                                            InviteCodes.normalize(inviteCode), GroupStatus.WAITING)
                                    .filter(found -> found.isJoinable(now, waitingExpiry))
                                    .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
                    return GroupMapper.toInviteResponse(
                            group, participants.countActiveByGroupId(group.getId()));
                });
    }

    /** 10.3. 정원 확인과 면접 만들기를 그룹 행 잠금 안에서 해 마지막 자리에 두 명이 동시에 들어오지 못하게 한다. */
    public GroupResponse join(long userId, GroupJoinRequest request) {
        OffsetDateTime now = OffsetDateTime.now();
        GroupResponse response =
                transactions.execute(
                        status -> {
                            User user = lockUser(userId);
                            requireNotInGroup(userId, now);
                            InterviewGroup group =
                                    groups.findIdByInviteCodeAndStatus(
                                                    InviteCodes.normalize(request.inviteCode()),
                                                    GroupStatus.WAITING)
                                            .flatMap(groups::findByIdForUpdate)
                                            .filter(found -> found.isJoinable(now, waitingExpiry))
                                            .orElseThrow(
                                                    () ->
                                                            new ApiException(
                                                                    ErrorCode.GROUP_NOT_FOUND));
                            if (participants.countActiveByGroupId(group.getId())
                                    >= group.getCapacity()) {
                                throw new ApiException(ErrorCode.GROUP_FULL);
                            }
                            participants.save(
                                    newParticipant(
                                            group,
                                            user,
                                            request.applicationId(),
                                            request.jobCategory(),
                                            now));
                            return response(
                                    group,
                                    userId,
                                    request.jobCategory() != group.getJobCategory(),
                                    now);
                        });
        touch(() -> presence.record(response.groupId(), userId, now.toInstant()));
        return response;
    }

    /**
     * 10.4. 대기실은 2초마다 부른다. 부를 때마다 대기실 접속 시각을 남기고, 만든 지 오래된 대기 그룹은 취소하며, 방장이 대기실 조회를 멈췄으면 남은 참가자 중
     * 가장 먼저 들어온 사람에게 방장을 넘긴다(6.1). 바꿀 일이 있을 때만 그룹 행을 잠근다.
     */
    public GroupResponse get(long userId, long groupId) {
        OffsetDateTime now = OffsetDateTime.now();
        boolean needsUpdate =
                Boolean.TRUE.equals(
                        transactions.execute(
                                status -> {
                                    InterviewGroup group = find(groupId);
                                    List<InterviewGroupParticipant> active =
                                            participants.findActiveByGroupId(groupId);
                                    requireParticipant(active, userId);
                                    if (group.getStatus().isLobby()) {
                                        touch(
                                                () ->
                                                        presence.record(
                                                                groupId, userId, now.toInstant()));
                                    }
                                    return group.isExpired(now, waitingExpiry)
                                            || isHostAway(group, active, now);
                                }));
        return transactions.execute(
                status -> {
                    InterviewGroup group = needsUpdate ? lock(groupId) : find(groupId);
                    List<InterviewGroupParticipant> active =
                            participants.findActiveByGroupId(groupId);
                    requireParticipant(active, userId);
                    if (group.isExpired(now, waitingExpiry)) {
                        group.cancel();
                    } else if (isHostAway(group, active, now)) {
                        handOverHost(group, active);
                    }
                    return response(group, active, userId, null, now);
                });
    }

    /** 10.5. 대기실 · 시작 실패 상태에서만. 다시 보내도 결과가 같다. */
    public GroupResponse changeReady(long userId, long groupId, boolean ready) {
        OffsetDateTime now = OffsetDateTime.now();
        return transactions.execute(
                status -> {
                    InterviewGroup group = lock(groupId);
                    List<InterviewGroupParticipant> active =
                            participants.findActiveByGroupId(groupId);
                    InterviewGroupParticipant me = requireParticipant(active, userId);
                    if (!group.getStatus().isLobby() || group.isExpired(now, waitingExpiry)) {
                        throw new ApiException(ErrorCode.INVALID_GROUP_STATE);
                    }
                    me.changeReady(ready, now);
                    return response(group, active, userId, null, now);
                });
    }

    /**
     * 10.6. 대기실 · 시작 실패 상태에서만 나간다. 면접은 시작하지 않은 채 남는다. 방장이 나가면 남은 참가자 중 가장 먼저 들어온 사람이 방장이 되고, 남은
     * 참가자가 없거나 시작 실패 뒤 1명 이하면 그룹을 취소한다(5.1).
     */
    public void leave(long userId, long groupId) {
        OffsetDateTime now = OffsetDateTime.now();
        transactions.executeWithoutResult(
                status -> {
                    InterviewGroup group = lock(groupId);
                    List<InterviewGroupParticipant> active =
                            participants.findActiveByGroupId(groupId);
                    InterviewGroupParticipant me = requireParticipant(active, userId);
                    if (!group.getStatus().isLobby()) {
                        throw new ApiException(ErrorCode.INVALID_GROUP_STATE);
                    }
                    me.leave(now);
                    List<InterviewGroupParticipant> remaining =
                            active.stream().filter(p -> p != me).toList();
                    if (remaining.isEmpty()
                            || (group.getStatus() == GroupStatus.START_FAILED
                                    && remaining.size() <= 1)) {
                        group.cancel();
                    } else if (group.isHost(userId)) {
                        handOverHost(group, remaining);
                    }
                });
        touch(() -> presence.remove(groupId, userId));
    }

    private User lockUser(long userId) {
        return users.findActiveForUpdate(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
    }

    // 회원 행을 잠근 뒤 부른다. 만든 지 오래돼 취소할 대기 그룹은 취소하고 넘어간다
    private void requireNotInGroup(long userId, OffsetDateTime now) {
        for (long groupId :
                participants.findCurrentGroupIds(userId, CURRENT_GROUP, CURRENT_SESSION)) {
            InterviewGroup group = lock(groupId);
            if (!group.isExpired(now, waitingExpiry)) {
                throw new ApiException(ErrorCode.ALREADY_IN_GROUP);
            }
            group.cancel();
        }
    }

    private InterviewGroupParticipant newParticipant(
            InterviewGroup group,
            User user,
            long applicationId,
            JobCategory jobCategory,
            OffsetDateTime now) {
        InterviewSession session =
                sessions.createForGroup(
                        user.getId(),
                        applicationId,
                        group.getPersona(),
                        group.getMode(),
                        group.getId(),
                        now);
        return new InterviewGroupParticipant(group, user, session, jobCategory, now);
    }

    // 방장이 대기실 조회를 hostTimeout 넘게 멈췄거나 이미 나갔다. 방장 자신의 조회는 먼저 접속 시각을 남기므로 걸리지 않는다
    private boolean isHostAway(
            InterviewGroup group, List<InterviewGroupParticipant> active, OffsetDateTime now) {
        if (!group.getStatus().isLobby()) {
            return false;
        }
        long hostId = group.getHost().getId();
        if (active.stream().noneMatch(p -> p.getUser().getId() == hostId)) {
            return true;
        }
        Optional<Instant> seen;
        try {
            seen = presence.lastSeen(group.getId(), hostId);
        } catch (RuntimeException e) {
            // 모르면 넘기지 않는다
            LOG.warn("대기실 접속 시각을 읽지 못했다: group={}", group.getId(), e);
            return false;
        }
        if (seen.isEmpty()) {
            // Redis 재시작 등으로 기록을 잃었다. 지금부터 센다(조회 중인 방장을 바로 바꾸지 않게)
            touch(() -> presence.recordIfAbsent(group.getId(), hostId, now.toInstant()));
            return false;
        }
        return seen.get().plus(hostTimeout).isBefore(now.toInstant());
    }

    // 대기실 접속 시각은 잃어도 다음 조회로 다시 채워지므로(4.4) Redis 장애로 요청을 실패시키지 않는다.
    // 만들기 · 참가는 커밋 뒤에 남기므로 여기서 실패하면 같은 멱등 키로 다시 보냈을 때 ALREADY_IN_GROUP이 된다
    private static void touch(Runnable write) {
        try {
            write.run();
        } catch (RuntimeException e) {
            LOG.warn("대기실 접속 시각을 남기지 못했다", e);
        }
    }

    // 지금 방장을 뺀 참가자 중 가장 먼저 들어온 사람(참가자는 들어온 순서로 받는다)
    private static void handOverHost(
            InterviewGroup group, List<InterviewGroupParticipant> candidates) {
        candidates.stream()
                .filter(p -> !group.isHost(p.getUser().getId()))
                .findFirst()
                .ifPresent(next -> group.changeHost(next.getUser()));
    }

    private InterviewGroup find(long groupId) {
        return groups.findById(groupId)
                .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
    }

    private InterviewGroup lock(long groupId) {
        return groups.findByIdForUpdate(groupId)
                .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
    }

    private static InterviewGroupParticipant requireParticipant(
            List<InterviewGroupParticipant> active, long userId) {
        return GroupResponses.participant(active, userId);
    }

    // 트랜잭션 안에서 부른다
    private GroupResponse response(
            InterviewGroup group, long userId, Boolean jobCategoryMismatch, OffsetDateTime now) {
        return response(
                group,
                participants.findActiveByGroupId(group.getId()),
                userId,
                jobCategoryMismatch,
                now);
    }

    private GroupResponse response(
            InterviewGroup group,
            List<InterviewGroupParticipant> active,
            long userId,
            Boolean jobCategoryMismatch,
            OffsetDateTime now) {
        return responses.of(group, active, userId, jobCategoryMismatch, null, now);
    }
}
