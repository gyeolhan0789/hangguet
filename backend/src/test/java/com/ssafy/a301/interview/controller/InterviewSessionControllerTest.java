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
import com.ssafy.a301.interview.dto.InterviewDtos.DailyInterviewCount;
import com.ssafy.a301.interview.dto.InterviewDtos.RoomResponse;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionCalendarResponse;
import com.ssafy.a301.interview.service.AnswerService;
import com.ssafy.a301.interview.service.InterviewSessionListService;
import com.ssafy.a301.interview.service.InterviewSessionService;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.util.List;
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
    @MockitoBean private InterviewSessionListService sessionList;
    @MockitoBean private UserRepository users;

    @Test
    void roomTokenRequiresLogin() throws Exception {
        mvc.perform(post("/api/v1/interview-sessions/55/room-token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void roomTokenUsesLoggedInUser() throws Exception {
        when(sessions.roomAccess(1, 55))
                .thenReturn(
                        new RoomResponse(
                                "wss://rtc.test",
                                "room-token",
                                OffsetDateTime.parse("2026-10-15T12:16:00+09:00")));

        mvc.perform(
                        post("/api/v1/interview-sessions/55/room-token")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.token").value("room-token"));
    }

    @Test
    void calendarRequiresLoginAndValidMonth() throws Exception {
        mvc.perform(get("/api/v1/interview-sessions/calendar").param("month", "2026-10"))
                .andExpect(status().isUnauthorized());
        mvc.perform(
                        get("/api/v1/interview-sessions/calendar")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        for (String month :
                List.of("2026-00", "2026-13", "2026-2", "2026-02-01", "0000-01", "bad", "")) {
            mvc.perform(
                            get("/api/v1/interview-sessions/calendar")
                                    .param("month", month)
                                    .with(jwt().jwt(token -> token.subject("1"))))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        }
    }

    @Test
    void calendarUsesLoggedInUserAndReturnsZeroDays() throws Exception {
        when(sessionList.calendar(1, YearMonth.of(2026, 10)))
                .thenReturn(
                        new SessionCalendarResponse(
                                "2026-10",
                                List.of(new DailyInterviewCount(LocalDate.of(2026, 10, 1), 0))));
        mvc.perform(
                        get("/api/v1/interview-sessions/calendar")
                                .param("month", "2026-10")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.month").value("2026-10"))
                .andExpect(jsonPath("$.content[0].practiceDate").value("2026-10-01"))
                .andExpect(jsonPath("$.content[0].interviewCount").value(0));
        verify(sessionList).calendar(1, YearMonth.of(2026, 10));
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
