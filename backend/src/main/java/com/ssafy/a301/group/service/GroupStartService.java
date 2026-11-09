package com.ssafy.a301.group.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.group.domain.CommonQuestion;
import com.ssafy.a301.group.domain.CommonQuestionType;
import com.ssafy.a301.group.domain.GroupCommonQuestion;
import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.dto.GroupDtos.GroupResponse;
import com.ssafy.a301.group.mapper.GroupMapper;
import com.ssafy.a301.group.repository.GroupCommonQuestionRepository;
import com.ssafy.a301.group.repository.InterviewGroupParticipantRepository;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.service.InterviewCapacity;
import com.ssafy.a301.interview.service.SessionRuntimeService;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/**
 * 10.7 그룹 면접 시작 · 다시 시작(docs/그룹면접-설계.md 6.2). 그룹 행 → 참가자 면접 행(id 순서)을 잠그고 조건을 확인한 뒤, 모든 면접을 시작하고 첫
 * 차례를 남긴다. 면접방 group-{groupId}는 첫 차례가 담긴 면접방 정보와 함께 잠금 안에서 열고 에이전트 하나에 질문을 배정한다(5.4와 같은 방식). 방을 열지
 * 못하면 트랜잭션을 되돌려 그룹 · 면접이 이전 상태로 남고(503), 커밋하지 못하면 연 방을 지운다. 화상이면 동시 진행 상한도 확인한다(503).
 */
@Service
public class GroupStartService {
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final SecureRandom RANDOM = new SecureRandom();
    // 시작 실패 뒤 다시 시작할 때 필요한 인원(API 명세 10.7)
    private static final int MIN_RESTART_PARTICIPANTS = 2;

    private final InterviewGroupRepository groups;
    private final InterviewGroupParticipantRepository participants;
    private final GroupCommonQuestionRepository commonQuestions;
    private final InterviewSessionRepository sessions;
    private final InterviewPlanRepository plans;
    private final SessionRuntimeService runtimes;
    private final InterviewRoom rooms;
    private final GroupResponses responses;
    private final TransactionTemplate transactions;
    private final InterviewCapacity capacity;
    private final GroupRoomUpdates roomUpdates;
    private final Duration waitingExpiry;
    private final Duration askingTimeout;

    public GroupStartService(
            InterviewGroupRepository groups,
            InterviewGroupParticipantRepository participants,
            GroupCommonQuestionRepository commonQuestions,
            InterviewSessionRepository sessions,
            InterviewPlanRepository plans,
            SessionRuntimeService runtimes,
            InterviewRoom rooms,
            GroupResponses responses,
            TransactionTemplate transactions,
            InterviewCapacity capacity,
            GroupRoomUpdates roomUpdates,
            @Value("${group.waiting-expiry:1h}") Duration waitingExpiry,
            @Value("${group.asking-timeout:20s}") Duration askingTimeout) {
        this.groups = groups;
        this.participants = participants;
        this.commonQuestions = commonQuestions;
        this.sessions = sessions;
        this.plans = plans;
        this.runtimes = runtimes;
        this.rooms = rooms;
        this.responses = responses;
        this.transactions = transactions;
        this.capacity = capacity;
        this.roomUpdates = roomUpdates;
        this.waitingExpiry = waitingExpiry;
        this.askingTimeout = askingTimeout;
    }

    /**
     * 10.7. 처음에는 인원이 정원과 같아야 하고, 시작 실패(START_FAILED) 뒤 다시 시작할 때는 2명 이상이면 된다. 둘 다 모두 준비했고 모든 플랜이
     * READY여야 한다. 답변 순서와 공통 질문은 처음 시작할 때 무작위로 정하고 다시 시작해도 바꾸지 않는다. 응답에는 방장의 입장 정보를 담고, 다른 참가자는
     * 10.4에서 IN_PROGRESS를 보고 5.14로 받는다.
     */
    public GroupResponse start(long userId, long groupId) {
        OffsetDateTime now = OffsetDateTime.now();
        return transactions.execute(
                status -> {
                    InterviewGroup group =
                            groups.findByIdForUpdate(groupId)
                                    .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
                    // 참가자 행을 읽기 전에 면접 행을 잠가 잠근 뒤의 상태를 본다
                    List<InterviewSession> locked =
                            sessions.findAllForUpdate(participants.findActiveSessionIds(groupId));
                    List<InterviewGroupParticipant> active =
                            participants.findActiveByGroupId(groupId);
                    InterviewGroupParticipant me = GroupResponses.participant(active, userId);
                    if (!group.isHost(userId)) {
                        throw new ApiException(ErrorCode.NOT_GROUP_HOST);
                    }
                    if (!group.getStatus().isLobby()
                            || group.isExpired(now, waitingExpiry)
                            || locked.stream().anyMatch(session -> !session.canStart())) {
                        throw new ApiException(ErrorCode.INVALID_GROUP_STATE);
                    }
                    requireReady(group, active, now);
                    boolean video = group.getMode() == InterviewMode.VIDEO;
                    // 그룹은 답변자 한 명만 인식하므로 화상 면접 하나로 센다(BE 설계 5.2)
                    if (video) {
                        capacity.reserveVideo(now);
                    }
                    List<InterviewGroupParticipant> ordered = orderTurns(group, active);
                    if (!group.hasCommonQuestions()) {
                        group.chooseCommonQuestions(
                                List.of(
                                        pick(CommonQuestionType.INTRO),
                                        pick(CommonQuestionType.CHARACTER)));
                    }
                    locked.forEach(session -> session.start(now));
                    group.start(now, ordered.getFirst().getSession().getId(), askingTimeout);
                    rooms.openGroup(
                            groupId,
                            video,
                            assignment(group, ordered),
                            JSON.writeValueAsString(GroupMapper.toRoomInfo(group, active, now)));
                    closeRoomOnRollback(groupId);
                    roomUpdates.markOpenedAfterCommit(group);
                    return responses.of(
                            group,
                            active,
                            userId,
                            null,
                            rooms.issueGroupAccess(groupId, me.getSession().getId(), video),
                            now);
                });
    }

    private void requireReady(
            InterviewGroup group, List<InterviewGroupParticipant> active, OffsetDateTime now) {
        boolean enough =
                group.getStatus() == GroupStatus.WAITING
                        ? active.size() == group.getCapacity()
                        : active.size() >= MIN_RESTART_PARTICIPANTS;
        boolean allReady =
                active.stream()
                        .allMatch(
                                p ->
                                        p.isReady()
                                                && runtimes.current(
                                                                        p.getSession().getId(),
                                                                        now.toInstant())
                                                                .planStatus()
                                                        == PlanStatus.READY);
        if (!enough || !allReady) {
            throw new ApiException(ErrorCode.GROUP_NOT_READY);
        }
    }

    // 처음 시작이면 무작위로 정한다. 다시 시작이면 시작 실패 뒤 나간 사람을 빼고 남은 참가자끼리 이전 순서대로 1부터 다시 센다
    private static List<InterviewGroupParticipant> orderTurns(
            InterviewGroup group, List<InterviewGroupParticipant> active) {
        List<InterviewGroupParticipant> ordered = new ArrayList<>(active);
        if (group.hasCommonQuestions()) {
            ordered.sort(Comparator.comparing(InterviewGroupParticipant::getTurnOrder));
        } else {
            Collections.shuffle(ordered, RANDOM);
        }
        for (int i = 0; i < ordered.size(); i++) {
            ordered.get(i).assignTurnOrder(i + 1);
        }
        return ordered;
    }

    private CommonQuestion pick(CommonQuestionType type) {
        List<GroupCommonQuestion> candidates = commonQuestions.findByTypeAndActiveTrue(type);
        if (candidates.isEmpty()) {
            throw new IllegalStateException("공통 질문 문항이 없다: " + type);
        }
        return candidates.get(RANDOM.nextInt(candidates.size())).toQuestion();
    }

    // 에이전트 배정 정보(AI 명세 6.7). 진행 순서 · 시간은 면접방 정보로 알리므로 질문만 담는다. 참가자는 답변 순서대로 담는다
    private Map<String, Object> assignment(
            InterviewGroup group, List<InterviewGroupParticipant> ordered) {
        Map<String, Object> assignment = new LinkedHashMap<>();
        assignment.put("kind", "GROUP");
        assignment.put("groupId", group.getId());
        assignment.put("mode", group.getMode().name());
        assignment.put("persona", group.getPersona().name());
        assignment.put("commonQuestions", group.getCommonQuestions());
        assignment.put(
                "participants",
                ordered.stream()
                        .map(
                                p -> {
                                    long sessionId = p.getSession().getId();
                                    return Map.of(
                                            "sessionId",
                                            sessionId,
                                            "identity",
                                            InterviewRoom.groupCandidate(sessionId),
                                            "personalQuestions",
                                            personalQuestions(sessionId));
                                })
                        .toList());
        return assignment;
    }

    private List<Map<String, String>> personalQuestions(long sessionId) {
        InterviewPlan plan =
                plans.findById(sessionId)
                        .orElseThrow(() -> new IllegalStateException("플랜이 없다: " + sessionId));
        return plan.getQuestions().stream()
                .sorted(Comparator.comparingInt(PlanQuestion::seq))
                .map(q -> Map.of("content", q.content(), "criteria", q.criteria()))
                .toList();
    }

    // 면접방을 연 뒤 커밋하지 못하면(롤백) 방을 지운다. 에이전트 · 녹화가 혼자 남지 않게 한다
    private void closeRoomOnRollback(long groupId) {
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCompletion(int status) {
                        if (status != STATUS_COMMITTED) {
                            rooms.closeGroup(groupId);
                        }
                    }
                });
    }
}
