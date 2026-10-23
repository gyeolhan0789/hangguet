package com.ssafy.a301.interview.room;

import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import java.util.Map;

/** 면접방(LiveKit, BE 설계 5.6). 방 이름은 interview-{sessionId}, 지원자 참가자 이름은 candidate다. 테스트에서는 가짜로 바꾼다. */
public interface InterviewRoom {

    /** 입장 정보. 외부 호출 없이 API 키로 서명만 한다. 화상은 마이크·카메라 송출, 채팅은 수신·메시지만 */
    RoomResponse issueAccess(long sessionId, boolean video);

    /**
     * 방을 만들고(화상이면 트랙 자동 녹화) 에이전트를 배정한다(AI 명세 6.1). 실패하면 만든 방을 지우고 503 ROOM_UNAVAILABLE을 던진다.
     *
     * @param assignment 에이전트 배정 정보(질문 5개·채점 기준·currentSeq)
     */
    void open(long sessionId, boolean video, Map<String, Object> assignment);

    /** 방을 지운다. 에이전트가 나가고 녹화도 끝난다. 실패해도 던지지 않고 로그만 남긴다 */
    void close(long sessionId);
}
