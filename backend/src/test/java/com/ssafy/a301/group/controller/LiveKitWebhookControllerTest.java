package com.ssafy.a301.group.controller;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.group.service.GroupAbsenceService;
import com.ssafy.a301.interview.room.GroupRoomEvent;
import com.ssafy.a301.interview.room.LiveKitWebhooks;
import io.livekit.server.AccessToken;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/** LiveKit 웹훅 본문을 UTF-8 그대로 확인하는지 본다. 문자셋 없는 application/webhook+json에 한글이 있어도 서명이 맞아야 한다 */
class LiveKitWebhookControllerTest {
    private static final String KEY = "test-key";
    private static final String SECRET = "test-only-livekit-secret-at-least-32-bytes";

    @Test
    void verifiesUtf8BodyWithoutCharset() throws Exception {
        GroupAbsenceService absences = mock(GroupAbsenceService.class);
        MockMvc mvc =
                MockMvcBuilders.standaloneSetup(
                                new LiveKitWebhookController(
                                        new LiveKitWebhooks(KEY, SECRET), absences))
                        .build();
        String body =
                "{\"event\":\"participant_left\",\"room\":{\"name\":\"group-7\"},"
                        + "\"participant\":{\"identity\":\"candidate-55\",\"name\":\"지원자\"},"
                        + "\"id\":\"evt-1\"}";
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        AccessToken token = new AccessToken(KEY, SECRET);
        token.setSha256(
                Base64.getEncoder()
                        .encodeToString(MessageDigest.getInstance("SHA-256").digest(bytes)));

        mvc.perform(
                        post("/api/v1/webhooks/livekit")
                                .contentType("application/webhook+json")
                                .header("Authorization", token.toJwt())
                                .content(bytes))
                .andExpect(status().isOk());
        verify(absences)
                .handle(new GroupRoomEvent("evt-1", GroupRoomEvent.Type.LEFT, 7L, 55L, null));
    }
}
