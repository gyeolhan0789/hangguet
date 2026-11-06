package com.ssafy.a301.interview.room;

import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import java.time.OffsetDateTime;
import java.util.Map;

/**
 * 면접방(LiveKit, BE 설계 5.6). 방 이름은 interview-{sessionId}, 지원자 참가자 이름은 candidate다. 그룹 면접은 방 이름
 * group-{groupId}, 지원자 참가자 이름 candidate-{sessionId}다(API 명세 10.10). 테스트에서는 가짜로 바꾼다.
 */
public interface InterviewRoom {

    /** 그룹 면접방의 지원자 참가자 이름. 에이전트 배정 정보에도 같은 값을 담는다(AI 명세 6.7) */
    static String groupCandidate(long sessionId) {
        return "candidate-" + sessionId;
    }

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

    /**
     * 개인 면접방에 지금 면접관 · 지원자가 있는지(AI 명세 6.5). 방이 없으면 아무도 없다. 조회하지 못하면 던진다.
     *
     * @return 면접관이 있는지와 지원자가 입장한 시각(없으면 null)
     */
    Presence presence(long sessionId);

    /**
     * 개인 화상 면접방의 트랙(지원자 영상 · 음성, 면접관 음성)이 모두 녹화 중인지 보고, 녹화가 시작되지 않은 트랙만 녹화를 다시 요청한다. 다시 요청도 실패하면 녹화
     * 없이 면접을 진행한다. 실패해도 던지지 않고 로그만 남긴다
     */
    void ensureTrackRecording(long sessionId);

    /** 면접방 참가자 현황 */
    record Presence(boolean interviewer, OffsetDateTime candidateJoinedAt) {}

    /** 그룹 면접방 입장 정보. 권한은 issueAccess와 같고 참가자 이름만 면접마다 다르다 */
    RoomResponse issueGroupAccess(long groupId, long sessionId, boolean video);

    /**
     * 그룹 면접방을 면접방 정보와 함께 만들고(화상이면 트랙 자동 녹화) 에이전트 하나를 배정한다(AI 명세 6.7). 실패하면 만든 방을 지우고 503
     * ROOM_UNAVAILABLE을 던진다.
     *
     * @param assignment 에이전트 배정 정보(공통 질문 · 참가자별 개인 질문)
     * @param metadata 면접방 정보(API 명세 10.11) JSON
     */
    void openGroup(long groupId, boolean video, Map<String, Object> assignment, String metadata);

    /** 그룹 면접방을 지운다. close와 같이 실패해도 던지지 않는다 */
    void closeGroup(long groupId);
}
