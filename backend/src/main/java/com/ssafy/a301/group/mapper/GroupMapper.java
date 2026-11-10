package com.ssafy.a301.group.mapper;

import com.ssafy.a301.group.domain.GroupPhase;
import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.domain.ParticipantState;
import com.ssafy.a301.group.domain.TurnKind;
import com.ssafy.a301.group.dto.GroupDtos.GroupResponse;
import com.ssafy.a301.group.dto.GroupDtos.InviteResponse;
import com.ssafy.a301.group.dto.GroupDtos.ParticipantResponse;
import com.ssafy.a301.group.dto.GroupDtos.RoomInfo;
import com.ssafy.a301.group.dto.GroupDtos.RoomParticipant;
import com.ssafy.a301.group.dto.GroupDtos.TurnInfo;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;

public final class GroupMapper {

    private GroupMapper() {}

    /**
     * @param jobCategoryMismatch 10.3 응답에서만 넘기고 그 외에는 null
     * @param turn 진행 중일 때만 넘기고 그 외에는 null
     * @param room 10.7 응답에서만 넘기고 그 외에는 null
     */
    public static GroupResponse toGroupResponse(
            InterviewGroup group,
            long mySessionId,
            List<ParticipantResponse> participants,
            Boolean jobCategoryMismatch,
            RoomInfo turn,
            RoomResponse room) {
        return new GroupResponse(
                group.getId(),
                group.getStatus(),
                group.getMode(),
                group.getPersona(),
                group.getJobCategory(),
                group.getCapacity(),
                group.getStatus() == GroupStatus.WAITING ? group.getInviteCode() : null,
                group.getHost().getId(),
                mySessionId,
                participants,
                jobCategoryMismatch,
                turn,
                room);
    }

    /**
     * 면접방 정보(API 명세 10.11). 시작한 그룹만 부른다. 참가자는 답변 순서대로 담는다. 남은 질문이 없거나 이탈한 사람을 기다리면(WAITING) turn은
     * null이다.
     */
    public static RoomInfo toRoomInfo(
            InterviewGroup group,
            List<InterviewGroupParticipant> participants,
            OffsetDateTime serverTime) {
        List<InterviewGroupParticipant> ordered =
                participants.stream()
                        .filter(p -> p.getTurnOrder() != null)
                        .sorted(Comparator.comparing(InterviewGroupParticipant::getTurnOrder))
                        .toList();
        Optional<InterviewGroupParticipant> current =
                ordered.stream()
                        .filter(p -> p.getSession().getId().equals(group.getTurnSessionId()))
                        .findFirst();
        boolean followup = group.getTurnKind() == TurnKind.FOLLOWUP;
        // 꼬리질문 판단(DECIDING)은 지금 질문을 끝낸 뒤라 끝낸 기본 질문 수에 이미 들어 있다
        int answering = group.getPhase() == GroupPhase.DECIDING ? 0 : 1;
        Integer baseIndex =
                followup ? null : current.map(p -> p.getBaseDone() + answering).orElse(null);
        TurnInfo turn =
                group.getTurnSessionId() == null
                        ? null
                        : new TurnInfo(
                                group.getTurnSessionId(),
                                group.getTurnSeq(),
                                group.getTurnKind(),
                                baseIndex,
                                group.getTurnAnnounce(),
                                group.getDeadlineAt(),
                                group.isExtended(),
                                current.map(
                                                p ->
                                                        InterviewGroupParticipant.MAX_FOLLOWUPS
                                                                - p.getFollowupsUsed())
                                        .orElse(0));
        int currentOrder = current.map(InterviewGroupParticipant::getTurnOrder).orElse(0);
        return new RoomInfo(
                group.getTurnVersion(),
                serverTime,
                group.getStatus(),
                group.getRound(),
                group.getPhase(),
                turn,
                ordered.stream().map(p -> toRoomParticipant(group.getStatus(), p)).toList(),
                turn == null
                        ? List.of()
                        : ordered.stream()
                                .filter(p -> p.getTurnOrder() > currentOrder)
                                .filter(p -> p.isAnswering() && !p.isAbsent())
                                .map(p -> p.getSession().getId())
                                .toList());
    }

    private static RoomParticipant toRoomParticipant(
            GroupStatus status, InterviewGroupParticipant participant) {
        ParticipantState state = state(status, participant);
        return new RoomParticipant(
                participant.getSession().getId(),
                participant.getTurnOrder(),
                state,
                state == ParticipantState.ABSENT ? participant.absentUntil() : null,
                Optional.ofNullable(participant.getSession().getEndReason())
                        .map(Enum::name)
                        .orElse(null));
    }

    public static ParticipantResponse toParticipantResponse(
            InterviewGroupParticipant participant,
            GroupStatus groupStatus,
            PlanStatus planStatus,
            String profileImageUrl) {
        return new ParticipantResponse(
                participant.getUser().getId(),
                participant.getUser().getNickname(),
                profileImageUrl,
                participant.getJobCategory(),
                participant.getSession().getId(),
                planStatus,
                participant.isReady(),
                participant.getTurnOrder(),
                state(groupStatus, participant));
    }

    public static InviteResponse toInviteResponse(InterviewGroup group, long participantCount) {
        return new InviteResponse(
                group.getId(),
                group.getHost().getNickname(),
                group.getMode(),
                group.getPersona(),
                group.getJobCategory(),
                group.getCapacity(),
                (int) participantCount);
    }

    // 시작 전이면 WAITING, 진행 중이면 면접이 진행 중인지 · 질문을 모두 마쳤는지 · 면접방에서 나갔는지로 정한다
    private static ParticipantState state(
            GroupStatus status, InterviewGroupParticipant participant) {
        if (status != GroupStatus.IN_PROGRESS && status != GroupStatus.ENDED) {
            return ParticipantState.WAITING;
        }
        if (participant.getSession().getStatus() != SessionStatus.IN_PROGRESS) {
            return ParticipantState.ENDED;
        }
        if (participant.isDone()) {
            return ParticipantState.DONE;
        }
        return participant.isAbsent() ? ParticipantState.ABSENT : ParticipantState.PRESENT;
    }
}
