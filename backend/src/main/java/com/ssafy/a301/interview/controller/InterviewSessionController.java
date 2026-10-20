package com.ssafy.a301.interview.controller;

import com.ssafy.a301.interview.dto.InterviewDtos.SttTokenResponse;
import com.ssafy.a301.interview.service.SttTokenService;
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

    public InterviewSessionController(SttTokenService sttTokens) {
        this.sttTokens = sttTokens;
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
}
