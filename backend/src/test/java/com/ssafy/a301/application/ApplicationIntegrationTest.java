package com.ssafy.a301.application;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue.Verdict;
import com.ssafy.a301.common.idempotency.IdempotencyStore;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.LockSupport;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 실제 PostgreSQL로 지원서 API의 응답 형식, 문항 저장, 소유권, 소프트 삭제, 지원서별 면접 목록(4.6)과 삭제 · 면접 만들기(5.1)의 행 잠금을 확인한다.
 * 작업 큐 · 멱등 키 저장소는 가짜로 바꾼다. 만든 회원과 데이터만 지운다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ApplicationIntegrationTest {
    private static final List<Map<String, String>> ITEMS =
            List.of(
                    Map.of("question", "지원 동기", "answer", "저는…"),
                    Map.of("question", "협업 경험", "answer", "함께\n했습니다."));

    @Autowired private MockMvc mvc;
    @Autowired private UserRepository users;
    @Autowired private ApplicationRepository applications;
    @Autowired private InterviewSessionRepository sessions;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private TransactionTemplate transactions;
    // 자기소개서 검증은 AI 작업자가 하므로 기본은 통과로 두고, 거절 · 판단 불가는 테스트에서 바꾼다
    @MockitoBean private CoverLetterCheckQueue coverLetterChecks;
    @MockitoBean private AiJobQueue queue;
    @MockitoBean private IdempotencyStore idempotency;
    private final JsonMapper json = JsonMapper.builder().build();
    private final List<Long> userIds = new ArrayList<>();

    @BeforeEach
    void passCoverLetterCheck() {
        when(coverLetterChecks.check(any(), any(), any())).thenReturn(Verdict.USABLE);
    }

    @AfterEach
    void cleanup() {
        for (long id : userIds) {
            String sessionsOfUser = "SELECT id FROM interview_sessions WHERE user_id = " + id;
            jdbc.update("DELETE FROM session_scores WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update(
                    "DELETE FROM answers WHERE question_id IN (SELECT id FROM interview_questions"
                            + " WHERE session_id IN ("
                            + sessionsOfUser
                            + "))");
            jdbc.update(
                    "DELETE FROM interview_questions WHERE session_id IN (" + sessionsOfUser + ")");
            // 5.1이 잘못 성공했을 때 남는 플랜 · 작업 행
            jdbc.update("DELETE FROM interview_plans WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM ai_job_outbox WHERE session_id IN (" + sessionsOfUser + ")");
            jdbc.update("DELETE FROM interview_sessions WHERE user_id = ?", id);
            jdbc.update(
                    "DELETE FROM cover_letter_items WHERE application_id IN"
                            + " (SELECT id FROM applications WHERE user_id = ?)",
                    id);
            jdbc.update("DELETE FROM applications WHERE user_id = ?", id);
            jdbc.update("DELETE FROM users WHERE id = ?", id);
        }
    }

    @Test
    void createSavesItemsInOrderAndGetReturnsThem() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");

        mvc.perform(as(user, get("/api/v1/applications/" + id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.coverLetterItems.length()").value(2))
                .andExpect(jsonPath("$.coverLetterItems[0].itemOrder").value(1))
                .andExpect(jsonPath("$.coverLetterItems[0].question").value("지원 동기"))
                .andExpect(jsonPath("$.coverLetterItems[1].itemOrder").value(2))
                .andExpect(jsonPath("$.coverLetterItems[1].answer").value("함께\n했습니다."))
                .andExpect(jsonPath("$.createdAt").exists());
        assertThat(
                        jdbc.queryForList(
                                "SELECT item_order FROM cover_letter_items WHERE application_id = ?"
                                        + " ORDER BY item_order",
                                Integer.class,
                                id))
                .containsExactly(1, 2);
    }

    // 4.1 경계: 문항 5개, 질문 255자, 답변 20,000자를 그대로 저장하고 돌려준다
    @Test
    void savesFiveItemsAtMaxLength() throws Exception {
        long user = newUser();
        List<Map<String, String>> items =
                IntStream.rangeClosed(1, 5)
                        .mapToObj(
                                n ->
                                        Map.of(
                                                "question",
                                                n + "가".repeat(254),
                                                "answer",
                                                n + "나".repeat(19999)))
                        .toList();
        long id = create(user, "○○전자", items);

        String body =
                mvc.perform(as(user, get("/api/v1/applications/" + id)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();

        JsonNode saved = json.readTree(body).path("coverLetterItems");
        assertThat(saved.size()).isEqualTo(5);
        for (int i = 0; i < 5; i++) {
            assertThat(saved.get(i).path("itemOrder").asInt()).isEqualTo(i + 1);
            assertThat(saved.get(i).path("question").asString())
                    .isEqualTo(items.get(i).get("question"));
            assertThat(saved.get(i).path("answer").asString())
                    .isEqualTo(items.get(i).get("answer"));
        }
    }

    // 문항은 저장된 순서(id)가 아니라 문항 순서(item_order)로 읽는다(@OrderBy)
    @Test
    void itemsAreReadByItemOrderNotByInsertOrder() throws Exception {
        long user = newUser();
        long id =
                jdbc.queryForObject(
                        "INSERT INTO applications (user_id, company_name, job_title, created_at)"
                                + " VALUES (?, '○○전자', '백엔드 개발자', now()) RETURNING id",
                        Long.class,
                        user);
        jdbc.update(
                "INSERT INTO cover_letter_items (application_id, item_order, question, answer)"
                        + " VALUES (?, 2, '협업 경험', '함께했습니다.')",
                id);
        jdbc.update(
                "INSERT INTO cover_letter_items (application_id, item_order, question, answer)"
                        + " VALUES (?, 1, '지원 동기', '저는…')",
                id);

        mvc.perform(as(user, get("/api/v1/applications/" + id)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.coverLetterItems[0].itemOrder").value(1))
                .andExpect(jsonPath("$.coverLetterItems[0].question").value("지원 동기"))
                .andExpect(jsonPath("$.coverLetterItems[1].itemOrder").value(2))
                .andExpect(jsonPath("$.coverLetterItems[1].question").value("협업 경험"));
    }

    // 4.1: AI가 쓸 수 없다고 본 자기소개서는 400 · 문항 필드 오류이고, 지원서 · 문항 행을 남기지 않는다
    @Test
    void unusableCoverLetterIsRejectedWithoutSaving() throws Exception {
        when(coverLetterChecks.check(any(), any(), any())).thenReturn(Verdict.UNUSABLE);
        long user = newUser();

        mvc.perform(createRequest(user, "○○전자", ITEMS))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("coverLetterItems"))
                .andExpect(
                        jsonPath("$.errors[0].reason")
                                .value(
                                        "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어"
                                                + " 주세요."));

        assertNothingSaved(user);
    }

    // 4.1: AI가 판단하지 못하면(장애 · 시간 초과) 503이고, 지원서 · 문항 행을 남기지 않는다
    @Test
    void unavailableCoverLetterCheckIsServiceUnavailableWithoutSaving() throws Exception {
        when(coverLetterChecks.check(any(), any(), any())).thenReturn(Verdict.UNAVAILABLE);
        long user = newUser();

        mvc.perform(createRequest(user, "○○전자", ITEMS))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("COVER_LETTER_CHECK_UNAVAILABLE"));

        assertNothingSaved(user);
    }

    @Test
    void listOfUserWithoutApplicationIsEmpty() throws Exception {
        long user = newUser();

        mvc.perform(as(user, get("/api/v1/applications")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.page.totalElements").value(0));
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
                .andExpect(jsonPath("$.content[0].coverLetterItems").doesNotExist())
                .andExpect(jsonPath("$.content[0].inUse").doesNotExist())
                .andExpect(jsonPath("$.page.size").value(2))
                .andExpect(jsonPath("$.page.number").value(0))
                .andExpect(jsonPath("$.page.totalElements").value(3))
                .andExpect(jsonPath("$.page.totalPages").value(2));
        mvc.perform(as(user, get("/api/v1/applications").param("page", "1").param("size", "2")))
                .andExpect(jsonPath("$.content[0].id").value(first));
        // JPA offset(int) 범위를 넘는 페이지도 500이 아니라 빈 목록과 실제 전체 건수다
        mvc.perform(
                        as(
                                user,
                                get("/api/v1/applications")
                                        .param("page", String.valueOf(Integer.MAX_VALUE))
                                        .param("size", "20")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.page.number").value(Integer.MAX_VALUE))
                .andExpect(jsonPath("$.page.totalElements").value(3));
    }

    @Test
    void othersApplicationLooksMissing() throws Exception {
        long owner = newUser();
        long other = newUser();
        long id = create(owner, "남의 회사");

        mvc.perform(as(other, get("/api/v1/applications/" + id)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
        mvc.perform(as(other, get("/api/v1/applications/" + id + "/interview-sessions")))
                .andExpect(status().isNotFound());
        mvc.perform(as(other, delete("/api/v1/applications/" + id)))
                .andExpect(status().isNotFound());
        mvc.perform(as(other, get("/api/v1/applications")))
                .andExpect(jsonPath("$.content").isEmpty());
        assertThat(applications.findById(id)).get().extracting("deletedAt").isNull();
    }

    // 4.5 · 4.3: 둘 중 하나를 지우면 목록과 전체 건수에는 남은 하나만 있다
    @Test
    void deletedApplicationLeavesOnlyTheOtherInList() throws Exception {
        long user = newUser();
        long deleted = create(user, "첫째");
        long kept = create(user, "둘째");

        mvc.perform(as(user, delete("/api/v1/applications/" + deleted)))
                .andExpect(status().isNoContent());

        mvc.perform(as(user, get("/api/v1/applications")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].id").value(kept))
                .andExpect(jsonPath("$.page.totalElements").value(1));
    }

    // 면접에 쓴 지원서도 지울 수 있고, 지워도 행 · 문항 · 그 지원서로 본 면접은 남는다
    @Test
    void deleteKeepsRowAndInterviewsButHidesApplication() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");
        long sessionId = practiceInterview(user, id, OffsetDateTime.now().minusHours(1));

        mvc.perform(as(user, delete("/api/v1/applications/" + id)))
                .andExpect(status().isNoContent());

        mvc.perform(as(user, get("/api/v1/applications/" + id))).andExpect(status().isNotFound());
        mvc.perform(as(user, get("/api/v1/applications/" + id + "/interview-sessions")))
                .andExpect(status().isNotFound());
        mvc.perform(as(user, delete("/api/v1/applications/" + id)))
                .andExpect(status().isNotFound());
        mvc.perform(as(user, get("/api/v1/applications")))
                .andExpect(jsonPath("$.content").isEmpty());
        assertThat(applications.findById(id)).get().extracting("deletedAt").isNotNull();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM cover_letter_items WHERE application_id = ?",
                                Integer.class,
                                id))
                .isEqualTo(2);
        assertThat(sessions.findById(sessionId)).isPresent();
    }

    // 지운 지원서로 본 면접도 날짜별 연습 기록(5.13)에 회사명과 함께 남는다
    @Test
    void interviewOfDeletedApplicationStaysInDailyList() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");
        long sessionId =
                practiceInterview(user, id, OffsetDateTime.parse("2026-10-21T10:00:00+09:00"));
        mvc.perform(as(user, delete("/api/v1/applications/" + id)))
                .andExpect(status().isNoContent());

        mvc.perform(as(user, get("/api/v1/interview-sessions").param("practiceDate", "2026-10-21")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].id").value(sessionId))
                .andExpect(jsonPath("$.content[0].companyName").value("○○전자"))
                .andExpect(jsonPath("$.content[0].jobTitle").value("백엔드 개발자"));
    }

    @Test
    void deletedApplicationCannotStartInterview() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");
        mvc.perform(as(user, delete("/api/v1/applications/" + id)))
                .andExpect(status().isNoContent());

        mvc.perform(startInterview(user, id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("APPLICATION_NOT_FOUND"));
    }

    // 4.5 · 5.1: 지우는 트랜잭션이 행을 잠근 동안 온 면접 만들기는 잠금을 기다렸다가, 지운 뒤의 행을 보고 404가 된다
    @Test
    void interviewRequestedWhileDeletingWaitsAndIsNotFound() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger lockerPid = new AtomicInteger();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> deleting =
                    pool.submit(
                            () ->
                                    transactions.executeWithoutResult(
                                            status -> {
                                                applications
                                                        .findForUpdate(id, user)
                                                        .orElseThrow()
                                                        .delete(KoreaTime.now());
                                                // 같은 트랜잭션의 커넥션이라 잠금을 쥔 백엔드다
                                                lockerPid.set(
                                                        jdbc.queryForObject(
                                                                "SELECT pg_backend_pid()",
                                                                Integer.class));
                                                locked.countDown();
                                                awaitUninterruptibly(release);
                                            }));
            assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();

            Future<MvcResult> creating =
                    pool.submit(() -> mvc.perform(startInterview(user, id)).andReturn());
            awaitBlockedBy(lockerPid.get());
            release.countDown();
            deleting.get(5, TimeUnit.SECONDS);
            MvcResult result = creating.get(5, TimeUnit.SECONDS);

            status().isNotFound().match(result);
            jsonPath("$.code").value("APPLICATION_NOT_FOUND").match(result);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM interview_sessions WHERE application_id = ?",
                                Integer.class,
                                id))
                .isZero();
        assertThat(applications.findById(id)).get().extracting("deletedAt").isNotNull();
    }

    // 4.6: 이 지원서로 본 연습 면접(답변 1개 이상인 ANALYZING · COMPLETED · FAILED)만 시작 시각 내림차순
    @Test
    void sessionsAreThisApplicationsPracticeInterviewsNewestFirst() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");
        long other = create(user, "△△소프트");
        OffsetDateTime now = OffsetDateTime.now();
        long older = practiceInterview(user, id, now.minusDays(2));
        long newer = practiceInterview(user, id, now.minusDays(1));
        practiceInterview(user, other, now.minusHours(3));
        // 시작 전(READY) 면접은 답변도 없고 연습 면접 상태도 아니다
        sessions.saveAndFlush(
                new InterviewSession(
                        users.getReferenceById(user),
                        applications.getReferenceById(id),
                        Persona.DEVIL,
                        InterviewMode.CHAT));

        mvc.perform(as(user, get("/api/v1/applications/" + id + "/interview-sessions")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].id").value(newer))
                .andExpect(jsonPath("$.content[1].id").value(older))
                .andExpect(jsonPath("$.content[0].companyName").value("○○전자"))
                .andExpect(jsonPath("$.content[0].status").value("FAILED"))
                .andExpect(jsonPath("$.content[0].answeredCount").value(1))
                .andExpect(jsonPath("$.page.totalElements").value(2));
        mvc.perform(
                        as(
                                user,
                                get("/api/v1/applications/" + id + "/interview-sessions")
                                        .param("page", "1")
                                        .param("size", "1")))
                .andExpect(jsonPath("$.content[0].id").value(older))
                .andExpect(jsonPath("$.page.totalPages").value(2));
        mvc.perform(as(user, get("/api/v1/applications/" + other + "/interview-sessions")))
                .andExpect(jsonPath("$.content.length()").value(1));
    }

    // 4.6 상태 조건: 답변이 있는 ANALYZING · COMPLETED도 연습 면접이다. COMPLETED는 기준별 등급을 준다
    @Test
    void sessionsIncludeAnalyzingAndCompletedWithAnswers() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");
        OffsetDateTime now = OffsetDateTime.now();
        long analyzing = interview(user, id, "ANALYZING", now.minusHours(2), true);
        long completed = interview(user, id, "COMPLETED", now.minusHours(1), true);
        score(completed, "JOB_FIT", 85);
        score(completed, "COVER_LETTER", 70);
        score(completed, "LOGIC", 59);
        score(completed, "DELIVERY", 70);

        mvc.perform(as(user, get("/api/v1/applications/" + id + "/interview-sessions")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.content[0].id").value(completed))
                .andExpect(jsonPath("$.content[0].status").value("COMPLETED"))
                .andExpect(jsonPath("$.content[0].summary").value("총평"))
                .andExpect(jsonPath("$.content[0].criterionGrades.length()").value(4))
                .andExpect(jsonPath("$.content[0].criterionGrades[0].criterion").value("JOB_FIT"))
                .andExpect(jsonPath("$.content[0].criterionGrades[0].grade").value("GOOD"))
                .andExpect(
                        jsonPath("$.content[0].criterionGrades[1].criterion").value("COVER_LETTER"))
                .andExpect(jsonPath("$.content[0].criterionGrades[1].grade").value("NORMAL"))
                .andExpect(jsonPath("$.content[0].criterionGrades[2].criterion").value("LOGIC"))
                .andExpect(jsonPath("$.content[0].criterionGrades[2].grade").value("WEAK"))
                .andExpect(jsonPath("$.content[0].criterionGrades[3].criterion").value("DELIVERY"))
                .andExpect(jsonPath("$.content[0].criterionGrades[3].grade").value("NORMAL"))
                .andExpect(jsonPath("$.content[1].id").value(analyzing))
                .andExpect(jsonPath("$.content[1].status").value("ANALYZING"))
                .andExpect(jsonPath("$.content[1].criterionGrades").isEmpty())
                .andExpect(jsonPath("$.page.totalElements").value(2));
    }

    // 4.6 상태 조건과 답변 조건을 따로 본다: 답변이 있어도 면접 중(IN_PROGRESS)이면, 끝났어도(FAILED) 답변이 없으면 빠진다
    @Test
    void sessionsExcludeInProgressAndUnansweredInterviews() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");
        OffsetDateTime now = OffsetDateTime.now();
        long practiced = practiceInterview(user, id, now.minusHours(3));
        interview(user, id, "IN_PROGRESS", now.minusHours(2), true);
        interview(user, id, "FAILED", now.minusHours(1), false);

        mvc.perform(as(user, get("/api/v1/applications/" + id + "/interview-sessions")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].id").value(practiced))
                .andExpect(jsonPath("$.page.totalElements").value(1));
    }

    @Test
    void sessionsOfApplicationWithoutInterviewIsEmpty() throws Exception {
        long user = newUser();
        long id = create(user, "○○전자");

        mvc.perform(as(user, get("/api/v1/applications/" + id + "/interview-sessions")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isEmpty())
                .andExpect(jsonPath("$.page.totalElements").value(0));
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
        return create(userId, companyName, ITEMS);
    }

    private long create(long userId, String companyName, List<Map<String, String>> items)
            throws Exception {
        MvcResult result =
                mvc.perform(createRequest(userId, companyName, items))
                        .andExpect(status().isCreated())
                        .andReturn();
        return json.readTree(result.getResponse().getContentAsString()).path("id").asLong();
    }

    private MockHttpServletRequestBuilder createRequest(
            long userId, String companyName, List<Map<String, String>> items) {
        return as(userId, post("/api/v1/applications"))
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        json.writeValueAsString(
                                Map.of(
                                        "companyName",
                                        companyName,
                                        "jobTitle",
                                        "백엔드 개발자",
                                        "coverLetterItems",
                                        items)));
    }

    /** 이 회원의 지원서도, 그 지원서의 문항도 하나도 없다. */
    private void assertNothingSaved(long userId) {
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM applications WHERE user_id = ?",
                                Integer.class,
                                userId))
                .isZero();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM cover_letter_items WHERE application_id IN"
                                        + " (SELECT id FROM applications WHERE user_id = ?)",
                                Integer.class,
                                userId))
                .isZero();
    }

    /** 답변 1개로 끝나 분석에 실패한(FAILED) 연습 면접을 만든다. 시작 시각을 정해 목록 순서를 고정한다. */
    private long practiceInterview(long userId, long applicationId, OffsetDateTime startedAt) {
        return interview(userId, applicationId, "FAILED", startedAt, true);
    }

    /** 면접 중(IN_PROGRESS)이 아니면 10분 뒤에 끝난 것으로, COMPLETED면 한 줄 총평('총평')을 넣는다. */
    private long interview(
            long userId,
            long applicationId,
            String status,
            OffsetDateTime startedAt,
            boolean answered) {
        long sessionId =
                jdbc.queryForObject(
                        "INSERT INTO interview_sessions (user_id, application_id, persona, mode,"
                                + " status, headline, started_at, ended_at, created_at)"
                                + " VALUES (?, ?, 'DEVIL', 'CHAT', ?, ?, ?, ?, ?) RETURNING id",
                        Long.class,
                        userId,
                        applicationId,
                        status,
                        "COMPLETED".equals(status) ? "총평" : null,
                        startedAt,
                        "IN_PROGRESS".equals(status) ? null : startedAt.plusMinutes(10),
                        startedAt);
        if (!answered) {
            return sessionId;
        }
        long questionId =
                jdbc.queryForObject(
                        "INSERT INTO interview_questions (session_id, seq, content, created_at)"
                                + " VALUES (?, 1, '질문', ?) RETURNING id",
                        Long.class,
                        sessionId,
                        startedAt);
        jdbc.update(
                "INSERT INTO answers (question_id, input_type, content, created_at)"
                        + " VALUES (?, 'TEXT', '답변', ?)",
                questionId,
                startedAt.plusMinutes(1));
        return sessionId;
    }

    private void score(long sessionId, String criterion, int score) {
        jdbc.update(
                "INSERT INTO session_scores (session_id, criterion, score, comment)"
                        + " VALUES (?, ?, ?, '평가')",
                sessionId,
                criterion,
                score);
    }

    private MockHttpServletRequestBuilder startInterview(long userId, long applicationId) {
        return as(userId, post("/api/v1/interview-sessions"))
                .header("Idempotency-Key", UUID.randomUUID().toString())
                .contentType(MediaType.APPLICATION_JSON)
                .content(
                        json.writeValueAsString(
                                Map.of(
                                        "applicationId",
                                        applicationId,
                                        "persona",
                                        "DEVIL",
                                        "mode",
                                        "CHAT")));
    }

    /** 잠금을 쥔 백엔드(pid)를 기다리는 다른 백엔드가 보일 때까지 짧게 확인한다(최대 5초). */
    private void awaitBlockedBy(int lockerPid) {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < deadline) {
            Integer waiting =
                    jdbc.queryForObject(
                            "SELECT count(*) FROM pg_stat_activity"
                                    + " WHERE wait_event_type = 'Lock'"
                                    + " AND ? = ANY(pg_blocking_pids(pid))",
                            Integer.class,
                            lockerPid);
            if (waiting != null && waiting > 0) {
                return;
            }
            LockSupport.parkNanos(TimeUnit.MILLISECONDS.toNanos(20));
        }
        throw new AssertionError("5초 안에 면접 만들기(5.1)가 지원서 행 잠금을 기다리지 않았다");
    }

    private static void awaitUninterruptibly(CountDownLatch latch) {
        try {
            if (!latch.await(10, TimeUnit.SECONDS)) {
                throw new IllegalStateException("잠금을 풀 신호가 오지 않았다");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private static MockHttpServletRequestBuilder as(
            long userId, MockHttpServletRequestBuilder request) {
        return request.with(jwt().jwt(token -> token.subject(Long.toString(userId))));
    }
}
