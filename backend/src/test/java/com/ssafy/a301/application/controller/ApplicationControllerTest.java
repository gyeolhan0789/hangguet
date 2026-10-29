package com.ssafy.a301.application.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
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
import com.ssafy.a301.application.dto.ApplicationDtos.CoverLetterItem;
import com.ssafy.a301.application.dto.ApplicationDtos.CoverLetterItemRequest;
import com.ssafy.a301.application.service.ApplicationService;
import com.ssafy.a301.auth.config.SecurityConfig;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.interview.service.InterviewSessionListService;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

// 기준: API 명세 4.1 · 4.2 · 4.3 · 4.5 · 4.6(문항 1~5개 · 질문 255자 · 답변 20,000자, 4.4 수정 없음)
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
    private static final String ITEM = "{\"question\":\"지원 동기\",\"answer\":\"저는…\"}";
    private static final ApplicationResponse RESPONSE =
            new ApplicationResponse(
                    10L,
                    "○○전자",
                    "백엔드 개발자",
                    List.of(new CoverLetterItem(1, "지원 동기", "저는…")),
                    OffsetDateTime.parse("2026-10-15T02:55:00Z"));

    @Autowired private MockMvc mvc;
    @MockitoBean private ApplicationService service;
    @MockitoBean private InterviewSessionListService sessions;
    @MockitoBean private UserRepository users;

    @Test
    void everyApiRequiresAuthentication() throws Exception {
        for (MockHttpServletRequestBuilder request :
                new MockHttpServletRequestBuilder[] {
                    post("/api/v1/applications"),
                    get("/api/v1/applications"),
                    get("/api/v1/applications/10"),
                    delete("/api/v1/applications/10"),
                    get("/api/v1/applications/10/interview-sessions")
                }) {
            mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        }
    }

    @Test
    void createSendsItemsInOrderAndIsCreatedWithKoreanOffset() throws Exception {
        when(service.create(
                        7L,
                        new ApplicationCreateRequest(
                                "○○전자",
                                "백엔드 개발자",
                                List.of(
                                        new CoverLetterItemRequest("지원 동기", "저는…"),
                                        new CoverLetterItemRequest("협업 경험", "함께\n했습니다.")))))
                .thenReturn(RESPONSE);
        mvc.perform(
                        json(
                                post("/api/v1/applications"),
                                body(
                                        "["
                                                + ITEM
                                                + ",{\"question\":\"협업 경험\",\"answer\":\"함께\\n"
                                                + "했습니다.\"}]")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(10))
                .andExpect(jsonPath("$.coverLetterItems[0].itemOrder").value(1))
                .andExpect(jsonPath("$.inUse").doesNotExist())
                .andExpect(jsonPath("$.createdAt").value("2026-10-15T11:55:00+09:00"));
    }

    @Test
    void createAcceptsFiveItemsAtMaxLength() throws Exception {
        String item =
                "{\"question\":\""
                        + "가".repeat(255)
                        + "\",\"answer\":\""
                        + "가".repeat(20000)
                        + "\"}";
        mvc.perform(
                        json(
                                post("/api/v1/applications"),
                                body("[" + String.join(",", item, item, item, item, item) + "]")))
                .andExpect(status().isCreated());

        ArgumentCaptor<ApplicationCreateRequest> request =
                ArgumentCaptor.forClass(ApplicationCreateRequest.class);
        verify(service).create(eq(7L), request.capture());
        assertThat(request.getValue().coverLetterItems())
                .hasSize(5)
                .allSatisfy(
                        received -> {
                            assertThat(received.question()).hasSize(255);
                            assertThat(received.answer()).hasSize(20000);
                        });
    }

    @Test
    void createRejectsInvalidItems() throws Exception {
        String six = String.join(",", ITEM, ITEM, ITEM, ITEM, ITEM, ITEM);
        String[][] cases = {
            {"[]", "coverLetterItems"},
            {"null", "coverLetterItems"},
            {"[null]", "coverLetterItems[0]"},
            {"[" + six + "]", "coverLetterItems"},
            {"[{\"question\":\" \",\"answer\":\"답변\"}]", "coverLetterItems[0].question"},
            {"[{\"question\":\"문항\",\"answer\":\" \\n \"}]", "coverLetterItems[0].answer"},
            {"[{\"question\":\"문항\"}]", "coverLetterItems[0].answer"},
            {
                "[{\"question\":\"" + "가".repeat(256) + "\",\"answer\":\"답변\"}]",
                "coverLetterItems[0].question"
            },
            {
                "[{\"question\":\"문항\",\"answer\":\"" + "가".repeat(20001) + "\"}]",
                "coverLetterItems[0].answer"
            }
        };
        for (String[] invalid : cases) {
            mvc.perform(json(post("/api/v1/applications"), body(invalid[0])))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                    .andExpect(jsonPath("$.errors[0].field").value(invalid[1]));
        }
        verify(service, never()).create(anyLong(), any());
    }

    @Test
    void createRejectsBlankCompanyName() throws Exception {
        mvc.perform(
                        json(
                                post("/api/v1/applications"),
                                "{\"companyName\":\" \",\"jobTitle\":\"백엔드\","
                                        + "\"coverLetterItems\":["
                                        + ITEM
                                        + "]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.errors[0].field").value("companyName"));
        verify(service, never()).create(anyLong(), any());
    }

    @Test
    void getReturnsOwnApplicationOrNotFound() throws Exception {
        when(service.get(7L, 10L)).thenReturn(RESPONSE);
        when(service.get(7L, 99L)).thenThrow(new ApiException(ErrorCode.APPLICATION_NOT_FOUND));

        mvc.perform(get("/api/v1/applications/10").with(USER_7))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.coverLetterItems[0].question").value("지원 동기"));
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
    void thereIsNoUpdateApi() throws Exception {
        mvc.perform(json(patch("/api/v1/applications/10"), "{\"companyName\":\"x\"}"))
                .andExpect(status().isMethodNotAllowed());
    }

    @Test
    void deleteIsNoContentOrNotFound() throws Exception {
        mvc.perform(delete("/api/v1/applications/12").with(USER_7))
                .andExpect(status().isNoContent());
        verify(service).delete(7L, 12L);

        doThrow(new ApiException(ErrorCode.APPLICATION_NOT_FOUND)).when(service).delete(7L, 99L);
        mvc.perform(delete("/api/v1/applications/99").with(USER_7))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
    }

    @Test
    void sessionsUseDefaultPagingAndRejectOutOfRange() throws Exception {
        mvc.perform(get("/api/v1/applications/12/interview-sessions").with(USER_7))
                .andExpect(status().isOk());
        verify(sessions).listByApplication(7L, 12L, 0, 10);

        for (String[] invalid : new String[][] {{"page", "-1"}, {"size", "0"}, {"size", "21"}}) {
            mvc.perform(
                            get("/api/v1/applications/12/interview-sessions")
                                    .param(invalid[0], invalid[1])
                                    .with(USER_7))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.errors[0].field").value(invalid[0]));
        }
    }

    @Test
    void sessionsOfMissingApplicationIsNotFound() throws Exception {
        when(sessions.listByApplication(7L, 99L, 0, 10))
                .thenThrow(new ApiException(ErrorCode.APPLICATION_NOT_FOUND));

        mvc.perform(get("/api/v1/applications/99/interview-sessions").with(USER_7))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
    }

    private static String body(String items) {
        return "{\"companyName\":\"○○전자\",\"jobTitle\":\"백엔드 개발자\",\"coverLetterItems\":"
                + items
                + "}";
    }

    private static MockHttpServletRequestBuilder json(
            MockHttpServletRequestBuilder request, String body) {
        return request.with(USER_7).contentType(MediaType.APPLICATION_JSON).content(body);
    }
}
