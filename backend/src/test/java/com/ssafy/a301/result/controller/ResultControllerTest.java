package com.ssafy.a301.result.controller;

import static org.mockito.Mockito.verify;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.auth.config.SecurityConfig;
import com.ssafy.a301.result.service.ResultService;
import com.ssafy.a301.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(ResultController.class)
@Import(SecurityConfig.class)
@TestPropertySource(
        properties = {
            "auth.jwt-secret=test-secret-at-least-thirty-two-bytes",
            "auth.access-ttl=1h",
            "auth.refresh-ttl=30d"
        })
class ResultControllerTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private ResultService results;
    @MockitoBean private UserRepository users;

    @Test
    void requiresLogin() throws Exception {
        mvc.perform(get("/api/v1/interview-sessions/55/result"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/interview-sessions/55/replay"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void usesLoggedInUser() throws Exception {
        mvc.perform(
                        get("/api/v1/interview-sessions/55/result")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk());
        mvc.perform(
                        get("/api/v1/interview-sessions/55/replay")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk());
        verify(results).result(1, 55);
        verify(results).replay(1, 55);
    }

    @Test
    void invalidSessionIdIsBadRequest() throws Exception {
        mvc.perform(
                        get("/api/v1/interview-sessions/abc/result")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isBadRequest());
    }
}
