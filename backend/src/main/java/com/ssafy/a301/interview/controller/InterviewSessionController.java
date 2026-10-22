package com.ssafy.a301.interview.controller;

import com.ssafy.a301.interview.dto.InterviewDtos.SessionListResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SttTokenResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.TtsTokenResponse;
import com.ssafy.a301.interview.service.InterviewSessionListService;
import com.ssafy.a301.interview.service.SttTokenService;
import com.ssafy.a301.interview.service.TtsTokenService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.LocalDate;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "5. 면접 진행")
@RestController
@RequestMapping("/api/v1/interview-sessions")
public class InterviewSessionController {
    private final SttTokenService sttTokens;
    private final TtsTokenService ttsTokens;
    private final InterviewSessionListService sessionList;

    public InterviewSessionController(
            SttTokenService sttTokens,
            TtsTokenService ttsTokens,
            InterviewSessionListService sessionList) {
        this.sttTokens = sttTokens;
        this.ttsTokens = ttsTokens;
        this.sessionList = sessionList;
    }

    @Operation(summary = "5.13 연습 면접 목록", description = "선택한 한국 날짜에 시작한 본인 면접 기록을 최근 순으로 준다.")
    @GetMapping
    public SessionListResponse list(
            @AuthenticationPrincipal Jwt jwt,
            @Parameter(description = "연습 날짜(한국 시간)", example = "2026-10-21")
                    @RequestParam
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate practiceDate,
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "5")
                    @RequestParam(defaultValue = "5")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        return sessionList.list(Long.parseLong(jwt.getSubject()), practiceDate, page, size);
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
