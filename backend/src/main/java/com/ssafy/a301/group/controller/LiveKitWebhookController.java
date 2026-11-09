package com.ssafy.a301.group.controller;

import com.ssafy.a301.group.service.GroupAbsenceService;
import com.ssafy.a301.interview.room.LiveKitWebhooks;
import io.swagger.v3.oas.annotations.Hidden;
import java.nio.charset.StandardCharsets;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * LiveKit 서버가 부르는 웹훅(docs/그룹면접-설계.md 6.9). 화면이 쓰는 API가 아니라 API 문서에 넣지 않는다. 회원 인증 대신 LiveKit 서명을
 * 확인하고, 그룹 면접방의 지원자 · 면접관 입장 · 퇴장만 처리한다. 그 밖의 이벤트는 200으로 받고 무시한다.
 */
@Hidden
@RestController
@RequestMapping("/api/v1/webhooks")
public class LiveKitWebhookController {
    private final LiveKitWebhooks webhooks;
    private final GroupAbsenceService absences;

    public LiveKitWebhookController(LiveKitWebhooks webhooks, GroupAbsenceService absences) {
        this.webhooks = webhooks;
        this.absences = absences;
    }

    @PostMapping("/livekit")
    public ResponseEntity<Void> livekit(
            @RequestBody byte[] body,
            @RequestHeader(value = "Authorization", required = false) String authorization) {
        // 서명은 UTF-8 본문의 SHA-256이다. Content-Type(application/webhook+json)에 문자셋이 없어 문자열로 받으면 한글이 깨져
        // 서명이 틀린다
        webhooks.receive(new String(body, StandardCharsets.UTF_8), authorization)
                .ifPresent(absences::handle);
        return ResponseEntity.ok().build();
    }
}
