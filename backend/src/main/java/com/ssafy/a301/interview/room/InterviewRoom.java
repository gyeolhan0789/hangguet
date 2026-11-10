package com.ssafy.a301.interview.room;

import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * 면접방(LiveKit, BE 설계 5.6). 방 이름은 interview-{sessionId}, 지원자 참가자 이름은 candidate다. 그룹 면접은 방 이름
 * group-{groupId}, 지원자 참가자 이름 candidate-{sessionId}다(API 명세 10.10). 테스트에서는 가짜로 바꾼다.
 */
public interface InterviewRoom {
    // 에이전트가 면접방에 들어올 때 쓰는 참가자 이름(AI 명세 6.1)
    String INTERVIEWER = "interviewer";
    String GROUP_CANDIDATE_PREFIX = "candidate-";

    /** 그룹 면접방의 지원자 참가자 이름. 에이전트 배정 정보에도 같은 값을 담는다(AI 명세 6.7) */
    static String groupCandidate(long sessionId) {
        return GROUP_CANDIDATE_PREFIX + sessionId;
    }

    /** 그룹 면접방 참가자 이름에서 면접 id를 읽는다. 지원자가 아니면 비어 있다 */
    static Optional<Long> groupCandidateSession(String identity) {
        if (identity == null || !identity.startsWith(GROUP_CANDIDATE_PREFIX)) {
            return Optional.empty();
        }
        try {
            return Optional.of(Long.parseLong(identity.substring(GROUP_CANDIDATE_PREFIX.length())));
        } catch (NumberFormatException ex) {
            return Optional.empty();
        }
    }

    /** 입장 정보. 외부 호출 없이 API 키로 서명만 한다. 화상은 마이크·카메라 송출, 채팅은 수신·메시지만 */
    RoomResponse issueAccess(long sessionId, boolean video);

    /**
     * 방을 만들고(화상이면 트랙 자동 녹화) 에이전트를 배정한다(AI 명세 6.1). 실패하면 만든 방을 지우고 503 ROOM_UNAVAILABLE을 던진다.
     *
     * @param assignment 에이전트 배정 정보(질문 5개·채점 기준·currentSeq)
     * @param startedAt 면접 시작 시각. 녹화 위치를 시작 시도마다 나눈다(Recording.rawPrefix)
     */
    void open(
            long sessionId,
            boolean video,
            Map<String, Object> assignment,
            OffsetDateTime startedAt);

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
     *
     * @param startedAt 면접 시작 시각. 방을 열 때와 같은 녹화 위치에 다시 요청한다
     */
    void ensureTrackRecording(long sessionId, OffsetDateTime startedAt);

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
     * @param startedAt 이번 시작 시도의 시각. 녹화 원본 위치를 시도마다 나눈다
     */
    void openGroup(
            long groupId,
            boolean video,
            Map<String, Object> assignment,
            String metadata,
            OffsetDateTime startedAt);

    /** 그룹 면접방을 지운다. close와 같이 실패해도 던지지 않는다 */
    void closeGroup(long groupId);

    /**
     * 그룹 면접방에 지금 누가 있는지(ListParticipants, docs/그룹면접-설계.md 6.9). 웹훅이 빠져도 이것으로 이탈 상태를 맞춘다. 방이 없으면 아무도
     * 없다. 설정이 없으면(로컬) 비어 있고, 조회하지 못하면 던진다.
     */
    Optional<GroupPresence> groupPresence(long groupId);

    /** 그룹 면접방 참가자 현황. 면접관이 있는지와 들어와 있는 지원자의 면접 id */
    record GroupPresence(boolean interviewer, Set<Long> candidates) {}

    /** 면접을 끝낸 참가자를 그룹 면접방에서 내보낸다(docs/그룹면접-설계.md 6.10). close와 같이 실패해도 던지지 않는다 */
    void removeGroupParticipant(long groupId, long sessionId);

    /**
     * 그룹 면접방 정보를 바꾼다(UpdateRoomMetadata, docs/그룹면접-설계.md 6.5). 화면 · 에이전트가 바로 받는다. 실패해도 던지지 않고 로그만
     * 남긴다(업무는 이미 커밋했다).
     *
     * @param metadata 면접방 정보(API 명세 10.11) JSON
     * @return 보냈으면 true. 실패하면 마감 처리기가 다시 보낸다
     */
    boolean updateGroupInfo(long groupId, String metadata);

    /**
     * 채팅 최종 답변을 에이전트에게 보낸다(SendData 주제 group.answer, 대상 interviewer, AI 명세 6.7). 실패해도 던지지 않고 로그만
     * 남긴다.
     *
     * @param payload sessionId · seq · content · turnVersion JSON
     * @return 보냈으면 true. 실패하면 마감 처리기가 꼬리질문 판단 시간 안에서 다시 보낸다
     */
    boolean sendGroupAnswer(long groupId, String payload);
}
