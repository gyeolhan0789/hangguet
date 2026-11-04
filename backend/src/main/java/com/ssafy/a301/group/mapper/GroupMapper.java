package com.ssafy.a301.group.mapper;

import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.domain.ParticipantState;
import com.ssafy.a301.group.dto.GroupDtos.GroupResponse;
import com.ssafy.a301.group.dto.GroupDtos.InviteResponse;
import com.ssafy.a301.group.dto.GroupDtos.ParticipantResponse;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionStatus;
import java.util.List;

public final class GroupMapper {

    private GroupMapper() {}

    /**
     * @param jobCategoryMismatch 10.3 응답에서만 넘기고 그 외에는 null
     */
    public static GroupResponse toGroupResponse(
            InterviewGroup group,
            long mySessionId,
            List<ParticipantResponse> participants,
            Boolean jobCategoryMismatch) {
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
                jobCategoryMismatch);
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

    // 시작 전이면 WAITING, 진행 중이면 면접이 진행 중인지로 정한다. 이탈(ABSENT) · 질문을 모두 마침(DONE)은 진행을 구현할 때 더한다
    private static ParticipantState state(
            GroupStatus status, InterviewGroupParticipant participant) {
        if (status != GroupStatus.IN_PROGRESS && status != GroupStatus.ENDED) {
            return ParticipantState.WAITING;
        }
        return participant.getSession().getStatus() == SessionStatus.IN_PROGRESS
                ? ParticipantState.PRESENT
                : ParticipantState.ENDED;
    }
}
