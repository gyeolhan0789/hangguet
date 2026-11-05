package com.ssafy.a301.group.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.group.domain.GroupStatus;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.dto.GroupDtos.GroupResponse;
import com.ssafy.a301.group.dto.GroupDtos.ParticipantResponse;
import com.ssafy.a301.group.mapper.GroupMapper;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.service.SessionRuntimeService;
import com.ssafy.a301.storage.s3.S3FileStorage;
import java.time.OffsetDateTime;
import java.util.List;
import org.springframework.stereotype.Component;

/** 그룹 응답(API 명세 10장). 10.1 · 10.3 · 10.4 · 10.7이 같은 형식으로 준다. 트랜잭션 안에서 부른다. */
@Component
class GroupResponses {
    private final SessionRuntimeService runtimes;
    private final S3FileStorage storage;

    GroupResponses(SessionRuntimeService runtimes, S3FileStorage storage) {
        this.runtimes = runtimes;
        this.storage = storage;
    }

    /**
     * @param active 나가지 않은 참가자(들어온 순서)
     * @param jobCategoryMismatch 10.3 응답에서만 넘기고 그 외에는 null
     * @param room 10.7 응답에서만 넘기고 그 외에는 null
     */
    GroupResponse of(
            InterviewGroup group,
            List<InterviewGroupParticipant> active,
            long userId,
            Boolean jobCategoryMismatch,
            RoomResponse room,
            OffsetDateTime now) {
        List<ParticipantResponse> items =
                active.stream()
                        .filter(p -> p.getLeftAt() == null)
                        .map(
                                p ->
                                        GroupMapper.toParticipantResponse(
                                                p,
                                                group.getStatus(),
                                                runtimes.current(
                                                                p.getSession().getId(),
                                                                now.toInstant())
                                                        .planStatus(),
                                                storage.presignDownload(
                                                        p.getUser().getProfileImageKey())))
                        .toList();
        return GroupMapper.toGroupResponse(
                group,
                participant(active, userId).getSession().getId(),
                items,
                jobCategoryMismatch,
                group.getStatus() == GroupStatus.IN_PROGRESS
                        ? GroupMapper.toRoomInfo(group, active, now)
                        : null,
                room);
    }

    // 참가자가 아니면 그룹이 없는 것처럼 404
    static InterviewGroupParticipant participant(
            List<InterviewGroupParticipant> active, long userId) {
        return active.stream()
                .filter(p -> p.getUser().getId() == userId)
                .findFirst()
                .orElseThrow(() -> new ApiException(ErrorCode.GROUP_NOT_FOUND));
    }
}
