package com.ssafy.a301.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** 실제 PostgreSQL로 지원서 API의 응답 형식, 소유권, 면접에 쓴 지원서 보호를 확인한다. 만든 회원과 데이터만 지운다. */
@SpringBootTest
@AutoConfigureMockMvc
class ApplicationIntegrationTest {
    @Autowired private MockMvc mvc;
    @Autowired private UserRepository users;
    @Autowired private ApplicationRepository applications;
    @Autowired private InterviewSessionRepository sessions;
    @Autowired private TransactionTemplate transactions;
    @Autowired private JdbcTemplate jdbc;
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<Long> userIds = new ArrayList<>();

    @AfterEach
    void cleanup() {
        for (long id : userIds) {
            jdbc.update("DELETE FROM interview_sessions WHERE user_id = ?", id);
            jdbc.update("DELETE FROM applications WHERE user_id = ?", id);
            jdbc.update("DELETE FROM users WHERE id = ?", id);
        }
    }

    @Test
    void listIsRecentFirstPagedWithoutCoverLetter() throws Exception {
        long user = newUser();
        long first = create(user, "첫째");
        long second = create(user, "둘째");
        long third = create(user, "셋째");

        mvc.perform(as(user, get("/api/v1/applications").param("size", "2")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(third))
                .andExpect(jsonPath("$.content[1].id").value(second))
                .andExpect(jsonPath("$.content[0].coverLetter").doesNotExist())
                .andExpect(jsonPath("$.content[0].inUse").value(false))
                .andExpect(jsonPath("$.page.size").value(2))
                .andExpect(jsonPath("$.page.number").value(0))
                .andExpect(jsonPath("$.page.totalElements").value(3))
                .andExpect(jsonPath("$.page.totalPages").value(2));
        mvc.perform(as(user, get("/api/v1/applications").param("page", "1").param("size", "2")))
                .andExpect(jsonPath("$.content[0].id").value(first));
    }

    @Test
    void emptyListIsOk() throws Exception {
        mvc.perform(as(newUser(), get("/api/v1/applications")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.page.totalElements").value(0));
    }

    @Test
    void othersApplicationLooksMissing() throws Exception {
        long owner = newUser();
        long other = newUser();
        long id = create(owner, "남의 회사");

        mvc.perform(as(other, get("/api/v1/applications/" + id)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        mvc.perform(
                        as(other, patch("/api/v1/applications/" + id))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"companyName\":\"바꿈\"}"))
                .andExpect(status().isNotFound());
        mvc.perform(as(other, delete("/api/v1/applications/" + id)))
                .andExpect(status().isNotFound());
        mvc.perform(as(other, get("/api/v1/applications")))
                .andExpect(jsonPath("$.content").isEmpty());
        assertThat(applications.findById(id)).get().extracting("companyName").isEqualTo("남의 회사");
    }

    @Test
    void updateChangesOnlySentFieldsAndDeleteRemoves() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");

        mvc.perform(
                        as(user, patch("/api/v1/applications/" + id))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"jobTitle\":\"서버 개발자\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.companyName").value("○○전자"))
                .andExpect(jsonPath("$.jobTitle").value("서버 개발자"))
                .andExpect(jsonPath("$.coverLetter").value("저는…"));

        mvc.perform(as(user, delete("/api/v1/applications/" + id)))
                .andExpect(status().isNoContent());
        mvc.perform(as(user, get("/api/v1/applications/" + id))).andExpect(status().isNotFound());
    }

    @Test
    void applicationUsedInInterviewIsProtected() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");
        startInterview(user, id);

        mvc.perform(as(user, get("/api/v1/applications/" + id)))
                .andExpect(jsonPath("$.inUse").value(true));
        mvc.perform(as(user, get("/api/v1/applications")))
                .andExpect(jsonPath("$.content[0].inUse").value(true));
        mvc.perform(
                        as(user, patch("/api/v1/applications/" + id))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"companyName\":\"바꿈\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_IN_USE"));
        mvc.perform(as(user, delete("/api/v1/applications/" + id)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("APPLICATION_IN_USE"));
        assertThat(applications.findById(id)).get().extracting("companyName").isEqualTo("○○전자");
    }

    // 면접을 만드는 트랜잭션이 끝나기 전에 삭제가 들어와도, 삭제는 기다렸다가 사용 중으로 거절된다
    @Test
    void deleteWaitingForInterviewCreationIsConflict() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");
        var inserted = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var interview =
                CompletableFuture.runAsync(
                        () ->
                                transactions.executeWithoutResult(
                                        status -> {
                                            sessions.saveAndFlush(
                                                    new InterviewSession(
                                                            users.getReferenceById(user),
                                                            applications.getReferenceById(id),
                                                            Persona.DEVIL,
                                                            InterviewMode.VIDEO));
                                            inserted.countDown();
                                            await(release);
                                        }));
        assertThat(inserted.await(5, TimeUnit.SECONDS)).isTrue();

        var deletion =
                CompletableFuture.supplyAsync(
                        () -> {
                            try {
                                return mvc.perform(as(user, delete("/api/v1/applications/" + id)))
                                        .andReturn()
                                        .getResponse()
                                        .getStatus();
                            } catch (Exception ex) {
                                throw new IllegalStateException(ex);
                            }
                        });
        Thread.sleep(300);
        assertThat(deletion).isNotDone();
        release.countDown();
        interview.get(5, TimeUnit.SECONDS);

        assertThat(deletion.get(5, TimeUnit.SECONDS)).isEqualTo(409);
        assertThat(applications.findById(id)).isPresent();
    }

    private long newUser() {
        long id =
                users.saveAndFlush(
                                new User(
                                        "application-it-" + UUID.randomUUID() + "@example.com",
                                        "hash",
                                        "지원서 검증"))
                        .getId();
        userIds.add(id);
        return id;
    }

    private long create(long userId, String companyName) throws Exception {
        MvcResult result =
                mvc.perform(
                                as(userId, post("/api/v1/applications"))
                                        .contentType(MediaType.APPLICATION_JSON)
                                        .content(
                                                json.writeValueAsString(
                                                        Map.of(
                                                                "companyName",
                                                                companyName,
                                                                "jobTitle",
                                                                "백엔드 개발자",
                                                                "coverLetter",
                                                                "저는…"))))
                        .andExpect(status().isCreated())
                        .andReturn();
        return json.readTree(result.getResponse().getContentAsString()).path("id").asLong();
    }

    private void startInterview(long userId, long applicationId) {
        Application application = applications.findById(applicationId).orElseThrow();
        sessions.saveAndFlush(
                new InterviewSession(
                        users.getReferenceById(userId),
                        application,
                        Persona.DEVIL,
                        InterviewMode.VIDEO));
    }

    private static MockHttpServletRequestBuilder as(
            long userId, MockHttpServletRequestBuilder request) {
        return request.with(jwt().jwt(token -> token.subject(Long.toString(userId))));
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(5, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(ex);
        }
    }
}
