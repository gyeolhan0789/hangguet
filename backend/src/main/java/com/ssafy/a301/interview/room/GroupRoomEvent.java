package com.ssafy.a301.interview.room;

import java.time.OffsetDateTime;

/**
 * 그룹 면접방 참가자가 들어오거나 나갔다(LiveKit 웹훅, docs/그룹면접-설계.md 6.9).
 *
 * @param id 웹훅 이벤트 id. 같은 이벤트를 한 번만 처리하는 데 쓴다
 * @param sessionId 지원자의 면접 id. 면접관이면 null
 * @param occurredAt 이벤트가 생긴 시각(LiveKit은 초 단위로 준다). 모르면 null
 */
public record GroupRoomEvent(
        String id, Type type, long groupId, Long sessionId, OffsetDateTime occurredAt) {

    public enum Type {
        JOINED,
        LEFT
    }

    public boolean isInterviewer() {
        return sessionId == null;
    }
}
