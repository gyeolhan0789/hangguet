package com.ssafy.a301.interview.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.auth.config.SecurityConfig;
import com.ssafy.a301.common.idempotency.IdempotencyStore;
import com.ssafy.a301.interview.dto.InterviewDtos.SttTokenResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.TtsTokenResponse;
import com.ssafy.a301.interview.service.AnswerService;
import com.ssafy.a301.interview.service.InterviewSessionListService;
import com.ssafy.a301.interview.service.InterviewSessionService;
import com.ssafy.a301.interview.service.SttTokenService;
import com.ssafy.a301.interview.service.TtsTokenService;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(InterviewSessionController.class)
@Import(SecurityConfig.class)
@TestPropertySource(
        properties = {
            "auth.jwt-secret=test-secret-at-least-thirty-two-bytes",
            "auth.access-ttl=1h",
            "auth.refresh-ttl=30d"
        })
class InterviewSessionControllerTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private InterviewSessionService sessions;
    @MockitoBean private AnswerService answers;
    @MockitoBean private IdempotencyStore idempotency;
    @MockitoBean private SttTokenService sttTokens;
    @MockitoBean private TtsTokenService ttsTokens;
    @MockitoBean private InterviewSessionListService sessionList;
    @MockitoBean private UserRepository users;

    @Test
    void sttTokenRequiresLogin() throws Exception {
        mvc.perform(post("/api/v1/interview-sessions/55/stt-token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void sttTokenUsesLoggedInUser() throws Exception {
        when(sttTokens.issue(1, 55))
                .thenReturn(
                        new SttTokenResponse(
                                "temp-key", OffsetDateTime.parse("2026-10-15T12:16:00+09:00")));

        mvc.perform(
                        post("/api/v1/interview-sessions/55/stt-token")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").value("temp-key"));
    }

    @Test
    void ttsTokenRequiresLogin() throws Exception {
        mvc.perform(post("/api/v1/interview-sessions/55/questions/303/tts-token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void ttsTokenUsesLoggedInUser() throws Exception {
        when(ttsTokens.issue(1, 55, 303))
                .thenReturn(
                        new TtsTokenResponse(
                                "tts-token",
                                OffsetDateTime.parse("2026-10-15T12:21:12+09:00"),
                                "voice",
                                "model"));

        mvc.perform(
                        post("/api/v1/interview-sessions/55/questions/303/tts-token")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").value("tts-token"))
                .andExpect(jsonPath("$.voiceId").value("voice"));
    }

    @Test
    void listValidatesRequiredDateAndPageSize() throws Exception {
        mvc.perform(get("/api/v1/interview-sessions").with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isBadRequest());
        mvc.perform(
                        get("/api/v1/interview-sessions")
                                .param("practiceDate", "2026-10-21")
                                .param("size", "21")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void listUsesFiveAsDefaultPageSize() throws Exception {
        mvc.perform(
                        get("/api/v1/interview-sessions")
                                .param("practiceDate", "2026-10-21")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk());

        verify(sessionList).list(1, LocalDate.of(2026, 10, 21), 0, 5);
    }
}
