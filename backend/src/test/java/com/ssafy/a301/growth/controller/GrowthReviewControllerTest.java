package com.ssafy.a301.growth.controller;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.auth.config.SecurityConfig;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.growth.service.GrowthReviewService;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(GrowthReviewController.class)
@Import(SecurityConfig.class)
@TestPropertySource(
        properties = {
            "auth.jwt-secret=test-secret-at-least-thirty-two-bytes",
            "auth.access-ttl=1h",
            "auth.refresh-ttl=30d"
        })
class GrowthReviewControllerTest {
    @Autowired private MockMvc mvc;
    @MockitoBean private GrowthReviewService reviews;
    @MockitoBean private UserRepository users;

    @Test
    void requiresLogin() throws Exception {
        mvc.perform(get("/api/v1/growth-reviews/2026-10-21")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/growth-reviews")).andExpect(status().isUnauthorized());
    }

    @Test
    void reviewRejectsInvalidDate() throws Exception {
        // ISO 날짜로는 읽히지만 범위 밖인 날짜(0000년, 다섯 자리 이상·음수 연도)도 400이다
        for (String date :
                new String[] {
                    "2026-10-32",
                    "2026-1-1",
                    "bad",
                    "0000-12-31",
                    "+10000-01-01",
                    "+999999999-12-31",
                    "-999999999-01-01"
                }) {
            mvc.perform(
                            get("/api/v1/growth-reviews/" + date)
                                    .with(jwt().jwt(token -> token.subject("1"))))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        }
    }

    @Test
    void reviewAcceptsRangeBoundaries() throws Exception {
        for (String date : new String[] {"0001-01-01", "9999-12-31"}) {
            mvc.perform(
                            get("/api/v1/growth-reviews/" + date)
                                    .with(jwt().jwt(token -> token.subject("1"))))
                    .andExpect(status().isOk());
            verify(reviews).review(1, LocalDate.parse(date));
        }
    }

    @Test
    void reviewNotFoundIs404() throws Exception {
        when(reviews.review(1, LocalDate.of(2026, 10, 20)))
                .thenThrow(new ApiException(ErrorCode.GROWTH_REVIEW_NOT_FOUND));

        mvc.perform(
                        get("/api/v1/growth-reviews/2026-10-20")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("GROWTH_REVIEW_NOT_FOUND"));
    }

    @Test
    void recentValidatesPageAndUsesTwoAsDefaultSize() throws Exception {
        mvc.perform(
                        get("/api/v1/growth-reviews")
                                .param("size", "21")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mvc.perform(
                        get("/api/v1/growth-reviews")
                                .param("page", "-1")
                                .with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isBadRequest());

        mvc.perform(get("/api/v1/growth-reviews").with(jwt().jwt(token -> token.subject("1"))))
                .andExpect(status().isOk());
        verify(reviews).recent(1, 0, 2);
    }
}
