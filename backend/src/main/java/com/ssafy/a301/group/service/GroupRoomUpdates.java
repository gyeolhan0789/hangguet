package com.ssafy.a301.group.service;

import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.mapper.GroupMapper;
import com.ssafy.a301.interview.room.InterviewRoom;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;

/**
 * 그룹 면접방에 커밋된 진행 상태를 알린다(docs/그룹면접-설계.md 6.5). 면접방 정보 · 채팅 답변은 트랜잭션 안에서 만들고 커밋한 뒤에 보낸다. 되돌린 상태를 알리지
 * 않기 위해서다. 보내기가 실패해도 업무는 성공이다(재동기화는 마감 처리기가 한다).
 */
@Component
class GroupRoomUpdates {
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final InterviewRoom rooms;

    GroupRoomUpdates(InterviewRoom rooms) {
        this.rooms = rooms;
    }

    /** 커밋 뒤 면접방 정보(API 명세 10.11)를 바꾼다. 그룹 행을 잠근 트랜잭션 안에서 부른다 */
    void publishAfterCommit(
            InterviewGroup group, List<InterviewGroupParticipant> active, OffsetDateTime now) {
        long groupId = group.getId();
        String metadata = JSON.writeValueAsString(GroupMapper.toRoomInfo(group, active, now));
        afterCommit(() -> rooms.updateGroupInfo(groupId, metadata));
    }

    /** 커밋 뒤 채팅 최종 답변을 에이전트에게 보낸다(group.answer, AI 명세 6.7). 꼬리질문 판단 재료다 */
    void sendAnswerAfterCommit(InterviewGroup group, long sessionId, int seq, String content) {
        long groupId = group.getId();
        String payload =
                JSON.writeValueAsString(
                        Map.of(
                                "sessionId",
                                sessionId,
                                "seq",
                                seq,
                                "content",
                                content,
                                "turnVersion",
                                group.getTurnVersion()));
        afterCommit(() -> rooms.sendGroupAnswer(groupId, payload));
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
