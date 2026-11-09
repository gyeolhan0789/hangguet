package com.ssafy.a301.interview.room;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.room.GroupRoomEvent.Type;
import io.livekit.server.AccessToken;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Base64;
import java.util.List;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;

/** LiveKit 웹훅 서명 확인과 그룹 면접방 참가자 이벤트 읽기(docs/그룹면접-설계.md 6.9). 서명은 LiveKit 서버처럼 API 키로 만든다. */
class LiveKitWebhooksTest {
    private static final String KEY = "test-key";
    private static final String SECRET = "test-only-livekit-secret-at-least-32-bytes";
    private final LiveKitWebhooks webhooks = new LiveKitWebhooks(KEY, SECRET);

    @Test
    void readsGroupParticipantEvents() {
        String joined = body("participant_joined", "group-7", "candidate-55", "evt-1");
        assertThat(webhooks.receive(joined, sign(joined, SECRET)))
                .contains(new GroupRoomEvent("evt-1", Type.JOINED, 7L, 55L));
        String left = body("participant_left", "group-7", "interviewer", "evt-2");
        assertThat(webhooks.receive(left, sign(left, SECRET)))
                .contains(new GroupRoomEvent("evt-2", Type.LEFT, 7L, null));

        // 개인 면접방 · 녹화 같은 다른 참가자 · 그 밖의 이벤트는 무시한다
        for (String other :
                List.of(
                        body("participant_left", "interview-55", "candidate", "evt-3"),
                        body("participant_left", "group-7", "EG_recorder", "evt-4"),
                        body("room_finished", "group-7", "interviewer", "evt-5"))) {
            assertThat(webhooks.receive(other, sign(other, SECRET))).isEmpty();
        }
    }

    @Test
    void rejectsMissingOrWrongSignatureAndMissingKeys() {
        String body = body("participant_left", "group-7", "candidate-55", "evt-1");
        assertUnauthorized(() -> webhooks.receive(body, null));
        // 본문이 바뀌었다
        assertUnauthorized(() -> webhooks.receive(body.replace("55", "56"), sign(body, SECRET)));
        assertUnauthorized(
                () -> webhooks.receive(body, sign(body, "other-livekit-secret-at-least-32-bytes")));
        // 키가 없으면(로컬) 확인할 수 없다
        assertUnauthorized(() -> new LiveKitWebhooks("", "").receive(body, sign(body, SECRET)));
    }

    private static void assertUnauthorized(ThrowingCallable call) {
        assertThatThrownBy(call)
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.UNAUTHORIZED));
    }

    private static String body(String event, String room, String identity, String id) {
        return """
        {"event":"%s","room":{"name":"%s"},"participant":{"identity":"%s"},"id":"%s"}\
        """
                .formatted(event, room, identity, id);
    }

    // LiveKit 서버와 같이 본문 SHA-256을 담은 JWT를 API 키로 서명한다
    private static String sign(String body, String secret) {
        try {
            AccessToken token = new AccessToken(KEY, secret);
            token.setSha256(
                    Base64.getEncoder()
                            .encodeToString(
                                    MessageDigest.getInstance("SHA-256")
                                            .digest(body.getBytes(StandardCharsets.UTF_8))));
            return token.toJwt();
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }
}
