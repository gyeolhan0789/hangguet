package com.ssafy.a301.auth.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.auth.config.SecurityConfig;
import com.ssafy.a301.auth.service.AuthService;
import com.ssafy.a301.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AuthController.class)
@Import(SecurityConfig.class)
@TestPropertySource(
        properties = {
            "auth.jwt-secret=test-secret-at-least-thirty-two-bytes",
            "auth.access-ttl=1h",
            "auth.refresh-ttl=30d"
        })
class AuthControllerTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private AuthService service;
    @MockitoBean private UserRepository users;

    @Test
    void availabilityIsPublic() throws Exception {
        when(service.isEmailAvailable("a@test.com")).thenReturn(true);
        mvc.perform(get("/api/v1/auth/email-availability").param("email", "a@test.com"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(true));
    }

    @Test
    void emptyEmailIsValidationError() throws Exception {
        mvc.perform(get("/api/v1/auth/email-availability").param("email", ""))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void invalidSignupIsRejected() throws Exception {
        mvc.perform(
                        post("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void logoutRequiresAuthentication() throws Exception {
        mvc.perform(
                        post("/api/v1/auth/logout")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"refreshToken\":\"token\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
    }

    @Test
    void logoutUsesAuthenticatedUser() throws Exception {
        mvc.perform(
                        post("/api/v1/auth/logout")
                                .with(jwt().jwt(token -> token.subject("7")))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"refreshToken\":\"token\"}"))
                .andExpect(status().isNoContent());
        verify(service).logout(7L, "token");
    }
}
