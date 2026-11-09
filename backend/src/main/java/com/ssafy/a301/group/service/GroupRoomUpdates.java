package com.ssafy.a301.group.service;

import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.mapper.GroupMapper;
import com.ssafy.a301.group.repository.InterviewGroupRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;

/**
 * 그룹 면접방에 커밋된 진행 상태를 알린다(docs/그룹면접-설계.md 6.5). 면접방 정보 · 채팅 답변은 트랜잭션 안에서 만들고 커밋한 뒤에 보낸다. 되돌린 상태를 알리지
 * 않기 위해서다. 보내기에 성공하면 보낸 버전을 남기고, 실패하면 마감 처리기가 남은 버전을 보고 다시 보낸다(재동기화).
 */
@Component
class GroupRoomUpdates {
    private static final Logger LOG = LoggerFactory.getLogger(GroupRoomUpdates.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final InterviewRoom rooms;
    private final InterviewGroupRepository groups;

    GroupRoomUpdates(InterviewRoom rooms, InterviewGroupRepository groups) {
        this.rooms = rooms;
        this.groups = groups;
    }

    /** 커밋 뒤 면접방 정보(API 명세 10.11)를 바꾼다. 그룹 행을 잠근 트랜잭션 안에서 부른다 */
    void publishAfterCommit(
            InterviewGroup group, List<InterviewGroupParticipant> active, OffsetDateTime now) {
        long groupId = group.getId();
        int version = group.getTurnVersion();
        String metadata = metadata(group, active, now);
        afterCommit(() -> publish(groupId, version, metadata));
    }

    /** 커밋 뒤 채팅 최종 답변을 에이전트에게 보낸다(group.answer, AI 명세 6.7). 꼬리질문 판단 재료다 */
    void sendAnswerAfterCommit(InterviewGroup group, long sessionId, int seq, String content) {
        long groupId = group.getId();
        int version = group.getTurnVersion();
        String payload = answerPayload(sessionId, seq, content, version);
        afterCommit(() -> sendAnswer(groupId, version, payload));
    }

    /** 10.7. 면접방을 만들 때 면접방 정보를 같이 넣었으므로 커밋 뒤 그 버전을 반영한 것으로 남긴다 */
    void markOpenedAfterCommit(InterviewGroup group) {
        long groupId = group.getId();
        int version = group.getTurnVersion();
        afterCommit(() -> mark(() -> groups.markRoomVersion(groupId, version), groupId));
    }

    void publish(long groupId, int version, String metadata) {
        if (rooms.updateGroupInfo(groupId, metadata)) {
            mark(() -> groups.markRoomVersion(groupId, version), groupId);
        }
    }

    void sendAnswer(long groupId, int version, String payload) {
        if (rooms.sendGroupAnswer(groupId, payload)) {
            mark(() -> groups.markAnswerSent(groupId, version), groupId);
        }
    }

    // 업무는 이미 커밋했으므로 보낸 버전을 남기지 못해도 던지지 않는다. 마감 처리기가 한 번 더 보낼 뿐이다
    private static void mark(Runnable marker, long groupId) {
        try {
            marker.run();
        } catch (RuntimeException ex) {
            LOG.warn("보낸 버전을 남기지 못했다: group={}", groupId, ex);
        }
    }

    static String metadata(
            InterviewGroup group, List<InterviewGroupParticipant> active, OffsetDateTime now) {
        return JSON.writeValueAsString(GroupMapper.toRoomInfo(group, active, now));
    }

    static String answerPayload(long sessionId, int seq, String content, int version) {
        return JSON.writeValueAsString(
                Map.of(
                        "sessionId", sessionId,
                        "seq", seq,
                        "content", content,
                        "turnVersion", version));
    }

    private static void afterCommit(Runnable action) {
        TransactionSynchronizationManager.registerSynchronization(
                new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        action.run();
                    }
                });
    }
}
