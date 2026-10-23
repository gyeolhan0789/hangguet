package com.ssafy.a301.home.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.auth.config.SecurityConfig;
import com.ssafy.a301.home.dto.HomeDtos.PracticeLogsResponse;
import com.ssafy.a301.home.dto.HomeDtos.StatsResponse;
import com.ssafy.a301.home.service.PracticeStatsService;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.YearMonth;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(HomeController.class)
@Import(SecurityConfig.class)
@TestPropertySource(
        properties = {
            "auth.jwt-secret=test-secret-at-least-thirty-two-bytes",
            "auth.access-ttl=1h",
            "auth.refresh-ttl=30d"
        })
class HomeControllerTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private PracticeStatsService stats;
    @MockitoBean private UserRepository users;

    @Test
    void statsRequiresLogin() throws Exception {
        mvc.perform(get("/api/v1/users/me/stats")).andExpect(status().isUnauthorized());
    }

    @Test
    void statsUsesLoggedInUserAndKeepsNullJobTitle() throws Exception {
        when(stats.stats(1)).thenReturn(new StatsResponse(0, 0, 0, 0, null));

        mvc.perform(get("/api/v1/users/me/stats").with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentStreak").value(0))
                .andExpect(jsonPath("$.totalPracticeMinutes").value(0))
                .andExpect(jsonPath("$.latestJobTitle").isEmpty());
        verify(stats).stats(1);
    }

    @Test
    void practiceLogsRequiresLoginAndValidMonth() throws Exception {
        mvc.perform(get("/api/v1/practice-logs").param("month", "2026-10"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/practice-logs").with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        for (String month :
                List.of("2026-00", "2026-13", "2026-2", "2026-02-01", "0000-01", "bad", "")) {
            mvc.perform(
                            get("/api/v1/practice-logs")
                                    .param("month", month)
                                    .with(jwt().jwt(token -> token.subject("1"))))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        }
    }

    @Test
    void practiceLogsUsesLoggedInUserAndReturnsEmptyArray() throws Exception {
        when(stats.practiceLogs(1, YearMonth.of(2026, 10)))
                .thenReturn(new PracticeLogsResponse(List.of()));

        mvc.perform(
                        get("/api/v1/practice-logs")
                                .param("month", "2026-10")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray())
                .andExpect(jsonPath("$.content").isEmpty());
        verify(stats).practiceLogs(1, YearMonth.of(2026, 10));
    }
}
