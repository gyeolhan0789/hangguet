package com.ssafy.a301.interview.room;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.time.KoreaTime;
import io.livekit.server.WebhookReceiver;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Optional;
import livekit.LivekitWebhook.WebhookEvent;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * LiveKit 웹훅을 확인하고 그룹 면접방 참가자 이벤트로 읽는다(docs/그룹면접-설계.md 6.9). 회원 인증 대신 LiveKit이 API 키로 서명한
 * Authorization 헤더(본문 SHA-256을 담은 JWT)를 확인한다. 개인 면접방 · 녹화 · 그 밖의 이벤트는 무시한다.
 */
@Component
public class LiveKitWebhooks {
    private static final Logger LOG = LoggerFactory.getLogger(LiveKitWebhooks.class);
    private static final String GROUP_ROOM_PREFIX = "group-";

    private final String apiKey;
    private final String apiSecret;

    public LiveKitWebhooks(
            @Value("${livekit.api-key}") String apiKey,
            @Value("${livekit.api-secret}") String apiSecret) {
        this.apiKey = apiKey;
        this.apiSecret = apiSecret;
    }

    /**
     * 서명을 확인하고 그룹 면접방 참가자 이벤트면 돌려준다. 서명이 틀렸거나 키가 없으면(로컬) 401 UNAUTHORIZED를 던진다.
     *
     * @return 그룹 면접방의 지원자 · 면접관 입장 · 퇴장이 아니면 비어 있다
     */
    public Optional<GroupRoomEvent> receive(String body, String authorization) {
        if (apiKey.isBlank() || apiSecret.isBlank()) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
        WebhookEvent event;
        try {
            event = new WebhookReceiver(apiKey, apiSecret).receive(body, authorization);
        } catch (RuntimeException ex) {
            LOG.warn("LiveKit 웹훅 서명을 확인하지 못했다: {}", ex.getMessage());
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
        return toGroupEvent(event);
    }

    static Optional<GroupRoomEvent> toGroupEvent(WebhookEvent event) {
        GroupRoomEvent.Type type =
                switch (event.getEvent()) {
                    case "participant_joined" -> GroupRoomEvent.Type.JOINED;
                    case "participant_left" -> GroupRoomEvent.Type.LEFT;
                    default -> null;
                };
        String room = event.getRoom().getName();
        if (type == null || !room.startsWith(GROUP_ROOM_PREFIX)) {
            return Optional.empty();
        }
        long groupId;
        try {
            groupId = Long.parseLong(room.substring(GROUP_ROOM_PREFIX.length()));
        } catch (NumberFormatException ex) {
            return Optional.empty();
        }
        String identity = event.getParticipant().getIdentity();
        Long sessionId = InterviewRoom.groupCandidateSession(identity).orElse(null);
        if (sessionId == null && !InterviewRoom.INTERVIEWER.equals(identity)) {
            return Optional.empty();
        }
        // 방 이름은 다시 시작해도 같으므로, 이전 시도의 방을 지울 때 나온 이벤트를 가려내려고 발생 시각을 함께 넘긴다
        OffsetDateTime occurredAt =
                event.getCreatedAt() > 0
                        ? OffsetDateTime.ofInstant(
                                Instant.ofEpochSecond(event.getCreatedAt()), KoreaTime.ZONE)
                        : null;
        return Optional.of(new GroupRoomEvent(event.getId(), type, groupId, sessionId, occurredAt));
    }
}
