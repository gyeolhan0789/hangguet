package com.ssafy.a301.application.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationCreateRequest;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationResponse;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationUpdateRequest;
import com.ssafy.a301.application.service.ApplicationService;
import com.ssafy.a301.auth.config.SecurityConfig;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@WebMvcTest(ApplicationController.class)
@Import(SecurityConfig.class)
@TestPropertySource(
        properties = {
            "auth.jwt-secret=test-secret-at-least-thirty-two-bytes",
            "auth.access-ttl=1h",
            "auth.refresh-ttl=30d"
        })
class ApplicationControllerTest {
    private static final RequestPostProcessor USER_7 = jwt().jwt(token -> token.subject("7"));
    private static final ApplicationResponse RESPONSE =
            new ApplicationResponse(
                    10L,
                    "○○전자",
                    "백엔드 개발자",
                    "저는…",
                    OffsetDateTime.parse("2026-10-15T02:55:00Z"),
                    false);

    @Autowired private MockMvc mvc;
    @MockitoBean private ApplicationService service;
    @MockitoBean private UserRepository users;

    @Test
    void everyApiRequiresAuthentication() throws Exception {
        for (MockHttpServletRequestBuilder request :
                new MockHttpServletRequestBuilder[] {
                    post("/api/v1/applications"),
                    get("/api/v1/applications"),
                    get("/api/v1/applications/10"),
                    patch("/api/v1/applications/10"),
                    delete("/api/v1/applications/10")
                }) {
            mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        }
    }

    @Test
    void createIsCreatedWithKoreanOffset() throws Exception {
        when(service.create(7L, new ApplicationCreateRequest("○○전자", "백엔드 개발자", "저는…")))
                .thenReturn(RESPONSE);
        mvc.perform(
                        json(
                                post("/api/v1/applications"),
                                "{\"companyName\":\"○○전자\",\"jobTitle\":\"백엔드 개발자\","
                                        + "\"coverLetter\":\"저는…\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(10))
                .andExpect(jsonPath("$.inUse").value(false))
                .andExpect(jsonPath("$.createdAt").value("2026-10-15T11:55:00+09:00"));
    }

    @Test
    void createRejectsBlankAndTooLongFields() throws Exception {
        mvc.perform(
                        json(
                                post("/api/v1/applications"),
                                "{\"companyName\":\" \",\"jobTitle\":\"백엔드\","
                                        + "\"coverLetter\":\""
                                        + "가".repeat(3001)
                                        + "\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[?(@.field == 'companyName')]").exists())
                .andExpect(jsonPath("$.errors[?(@.field == 'coverLetter')]").exists());
        verify(service, never()).create(anyLong(), any());
    }

    @Test
    void getReturnsOwnApplicationOrNotFound() throws Exception {
        when(service.get(7L, 10L)).thenReturn(RESPONSE);
        when(service.get(7L, 99L)).thenThrow(new ApiException(ErrorCode.APPLICATION_NOT_FOUND));

        mvc.perform(get("/api/v1/applications/10").with(USER_7))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.coverLetter").value("저는…"));
        mvc.perform(get("/api/v1/applications/99").with(USER_7))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
    }

    @Test
    void listUsesDefaultPaging() throws Exception {
        mvc.perform(get("/api/v1/applications").with(USER_7)).andExpect(status().isOk());
        verify(service).list(7L, 0, 10);
    }

    @Test
    void listRejectsOutOfRangePaging() throws Exception {
        mvc.perform(get("/api/v1/applications").param("size", "21").with(USER_7))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("size"));
        mvc.perform(get("/api/v1/applications").param("page", "-1").with(USER_7))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("page"));
        verify(service, never()).list(anyLong(), anyInt(), anyInt());
    }

    @Test
    void updateSendsOnlyGivenFields() throws Exception {
        when(service.update(7L, 10L, new ApplicationUpdateRequest(null, "서버 개발자", null)))
                .thenReturn(RESPONSE);
        mvc.perform(json(patch("/api/v1/applications/10"), "{\"jobTitle\":\"서버 개발자\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void updateRejectsEmptyString() throws Exception {
        mvc.perform(json(patch("/api/v1/applications/10"), "{\"companyName\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("companyName"));
    }

    @Test
    void updateRejectsWhitespaceOnlyValues() throws Exception {
        for (String field : new String[] {"companyName", "jobTitle", "coverLetter"}) {
            mvc.perform(json(patch("/api/v1/applications/10"), "{\"" + field + "\":\"   \"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.errors[0].field").value(field))
                    .andExpect(jsonPath("$.errors[0].reason").value("공백만으로는 바꿀 수 없습니다."));
        }
        verify(service, never()).update(anyLong(), anyLong(), any());
    }

    @Test
    void applicationInUseIsConflict() throws Exception {
        when(service.update(7L, 10L, new ApplicationUpdateRequest("x", null, null)))
                .thenThrow(new ApiException(ErrorCode.APPLICATION_IN_USE));
        doThrow(new ApiException(ErrorCode.APPLICATION_IN_USE)).when(service).delete(7L, 10L);

        mvc.perform(json(patch("/api/v1/applications/10"), "{\"companyName\":\"x\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_IN_USE"));
        mvc.perform(delete("/api/v1/applications/10").with(USER_7))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_IN_USE"));
    }

    @Test
    void deleteIsNoContent() throws Exception {
        mvc.perform(delete("/api/v1/applications/12").with(USER_7))
                .andExpect(status().isNoContent());
        verify(service).delete(7L, 12L);
    }

    private static MockHttpServletRequestBuilder json(
            MockHttpServletRequestBuilder request, String body) {
        return request.with(USER_7).contentType(MediaType.APPLICATION_JSON).content(body);
    }
}
