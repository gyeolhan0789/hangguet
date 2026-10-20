package com.ssafy.a301.interview.controller;

import com.ssafy.a301.interview.dto.InterviewDtos.SttTokenResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.TtsTokenResponse;
import com.ssafy.a301.interview.service.SttTokenService;
import com.ssafy.a301.interview.service.TtsTokenService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "5. 면접 진행")
@RestController
@RequestMapping("/api/v1/interview-sessions")
public class InterviewSessionController {
    private final SttTokenService sttTokens;
    private final TtsTokenService ttsTokens;

    public InterviewSessionController(SttTokenService sttTokens, TtsTokenService ttsTokens) {
        this.sttTokens = sttTokens;
        this.ttsTokens = ttsTokens;
    }

    @Operation(
            summary = "5.10 실시간 음성 인식 토큰",
            description = "브라우저가 Soniox 실시간 음성 인식에 직접 연결할 때 쓰는 1회용 임시 키를 준다.")
    @PostMapping("/{sessionId}/stt-token")
    public SttTokenResponse sttToken(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId) {
        return sttTokens.issue(Long.parseLong(jwt.getSubject()), sessionId);
    }

    @Operation(
            summary = "5.12 질문 음성 토큰",
            description = "브라우저가 ElevenLabs에 직접 연결해 질문 음성을 받을 때 쓰는 1회용 토큰을 준다.")
    @PostMapping("/{sessionId}/questions/{questionId}/tts-token")
    public TtsTokenResponse ttsToken(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "면접 id", example = "55") @PathVariable long sessionId,
            @Parameter(description = "질문 id", example = "303") @PathVariable long questionId) {
        return ttsTokens.issue(Long.parseLong(jwt.getSubject()), sessionId, questionId);
    }
}
