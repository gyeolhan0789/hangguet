package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.domain.ApplicationClaim;
import com.ssafy.a301.application.repository.ApplicationClaimRepository;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.JobCategory;
import com.ssafy.a301.interview.InMemorySessionRuntimeStore;
import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.AiJobType;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.AnswerImpressions;
import com.ssafy.a301.interview.domain.AnswerSpeech;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewPlan;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanClaim;
import com.ssafy.a301.interview.domain.PlanQuestion;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.QuestionPoolItem;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.domain.SttGap;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.repository.AiJobRepository;
import com.ssafy.a301.interview.repository.AnswerRepository;
import com.ssafy.a301.interview.repository.InterviewPlanRepository;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.QuestionPoolItemRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.service.AiResultService.Outcome;
import com.ssafy.a301.interview.service.TrackRecordingCheck.FirstQuestionStarted;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.transaction.annotation.Transactional;

/** 실제 PostgreSQL로 결과 메시지 종류별 저장과 버림 조건(상태·중복)을 확인한다. Redis 진행 상태는 메모리 저장소다. */
@SpringBootTest
@Transactional
@Import(InMemorySessionRuntimeStore.Config.class)
@RecordApplicationEvents
class AiResultServiceTest {
    private static final OffsetDateTime STARTED_AT =
            OffsetDateTime.parse("2026-10-15T12:01:00+09:00");

    @Autowired private AiResultService results;
    @Autowired private InMemorySessionRuntimeStore runtimes;
    @Autowired private InterviewPlanRepository plans;
    @Autowired private InterviewQuestionRepository questions;
    @Autowired private AnswerRepository answers;
    @Autowired private AiJobRepository jobs;
    @Autowired private ApplicationClaimRepository applicationClaims;
    @Autowired private QuestionPoolItemRepository poolItems;
    @Autowired private QuestionPoolAssigner assigner;
    @Autowired private EntityManager em;
    @MockitoBean private AiJobQueue queue;
    @MockitoBean private InterviewRoom rooms;
    @Autowired private ApplicationEvents events;

    @BeforeEach
    void setUp() {
        runtimes.clear();
    }

    @Test
    void planProgressIsKeptOnlyWhileGenerating() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());

        assertThat(results.handle(planProgress(session, 50))).isEqualTo(Outcome.SAVED);
        assertThat(runtimes.find(session.getId()).orElseThrow().planProgress()).isEqualTo(50);

        runtimes.markPlanReady(session.getId());
        assertThat(results.handle(planProgress(session, 80))).isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void planCompletedIsSavedOnceAndMakesPlanReady() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());

        assertThat(results.handle(planCompleted(session, 5))).isEqualTo(Outcome.SAVED);
        InterviewPlan plan = plans.findById(session.getId()).orElseThrow();
        assertThat(plan.getQuestions()).hasSize(5);
        assertThat(plan.getClaims()).extracting(PlanClaim::id).containsExactly("c1");
        assertThat(plan.getModelVersion()).isEqualTo("gms-test");
        assertThat(runtimes.find(session.getId()).orElseThrow().planStatus())
                .isEqualTo(PlanStatus.READY);

        // 같은 결과가 다시 오면 버린다
        assertThat(results.handle(planCompleted(session, 5))).isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void planCompletedAfterSavedPlanOnlyMarksReady() {
        // 지난번에 플랜을 저장했지만 READY를 남기지 못하고 다시 처리한다
        InterviewSession session = newSession(InterviewMode.CHAT);
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());
        savePlan(session);

        assertThat(results.handle(planCompleted(session, 5))).isEqualTo(Outcome.DISCARDED);
        assertThat(runtimes.find(session.getId()).orElseThrow().planStatus())
                .isEqualTo(PlanStatus.READY);
        assertThat(plans.findById(session.getId()).orElseThrow().getPromptVersion())
                .isEqualTo("plan-v1");
    }

    @Test
    void planCompletedAfterFailureOrWithWrongQuestionsIsNotSaved() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());

        String wrongCount = planCompleted(session, 4);
        assertThatThrownBy(() -> results.handle(wrongCount))
                .isInstanceOf(InvalidAiResultException.class);
        // 질문 글이 비면 저장해도 질문을 낼 수 없다
        String blankQuestion =
                planCompleted(session, 5).replace("\"content\":\"질문3\"", "\"content\":\" \"");
        assertThatThrownBy(() -> results.handle(blankQuestion))
                .isInstanceOf(InvalidAiResultException.class);
        assertThat(plans.existsById(session.getId())).isFalse();

        assertThat(results.handle(planFailed(session))).isEqualTo(Outcome.SAVED);
        assertThat(runtimes.find(session.getId()).orElseThrow().planStatus())
                .isEqualTo(PlanStatus.FAILED);
        // 실패한 뒤 늦게 온 완료 결과는 버린다(5.3으로 다시 만든다)
        assertThat(results.handle(planCompleted(session, 5))).isEqualTo(Outcome.DISCARDED);
        assertThat(plans.existsById(session.getId())).isFalse();
    }

    // 기준: AI 명세 1.4 claims.extracted(지원서 주장이 없을 때만 저장하고, 그 지원서에서 주장을 기다리는 면접의 PLAN 등록)
    // · BE 설계 5.1(주장을 기다린 면접은 PLAN을 등록할 때 planStartedAt을 다시 기록한다)
    @Test
    void claimsAreSavedOnceAndOnlyWaitingSessionAsksPlan() {
        InterviewSession waiting = newSession(InterviewMode.CHAT);
        Application application = waiting.getApplication();
        runtimes.startPlan(waiting.getId(), STARTED_AT.toInstant());
        // 같은 지원서의 면접이지만 주장을 기다리지 않는다: 플랜이 이미 있다 · 플랜 생성이 실패했다
        InterviewSession planned = sessionOf(application, InterviewMode.CHAT);
        runtimes.startPlan(planned.getId(), STARTED_AT.toInstant());
        savePlan(planned);
        InterviewSession failed = sessionOf(application, InterviewMode.CHAT);
        runtimes.startPlan(failed.getId(), STARTED_AT.toInstant());
        runtimes.failPlanIfGenerating(failed.getId());

        assertThat(results.handle(claimsExtracted(application.getId(), "c1")))
                .isEqualTo(Outcome.SAVED);

        assertThat(applicationClaims.findByApplicationIdOrderById(application.getId()))
                .extracting(ApplicationClaim::toPlanClaim)
                .containsExactly(
                        new PlanClaim("c1", "조회 응답 시간을 40% 줄였다", "NUMBER", 4, List.of("실행·성과")),
                        new PlanClaim("c2", "팀 갈등을 조율했다", "EXPERIENCE", 7, List.of()));
        assertThat(applicationClaims.findByApplicationIdOrderById(application.getId()))
                .allSatisfy(
                        claim -> {
                            assertThat(claim.getPromptVersion()).isEqualTo("extract-claims-v1");
                            assertThat(claim.getModelVersion()).isEqualTo("gms-test");
                        });
        assertThat(planJobs(waiting)).hasSize(1);
        assertThat(planJobs(planned)).isEmpty();
        assertThat(planJobs(failed)).isEmpty();
        assertThat(runtimes.find(waiting.getId()).orElseThrow().planStatus())
                .isEqualTo(PlanStatus.GENERATING);
        assertThat(runtimes.findPlanStartedAt(waiting.getId()).orElseThrow())
                .isAfter(STARTED_AT.toInstant());

        // 같은 작업의 결과가 다시 오거나, 5.1 · 5.3이 다시 요청한 추출의 결과가 와도 처음 주장을 그대로 둔다
        assertThat(results.handle(claimsExtracted(application.getId(), "c9")))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(applicationClaims.findByApplicationIdOrderById(application.getId()))
                .extracting(ApplicationClaim::getClaimId)
                .containsExactly("c1", "c2");
        assertThat(planJobs(waiting)).hasSize(1);
        // 없는 지원서의 결과는 버린다
        assertThat(results.handle(claimsExtracted(-1L, "c1"))).isEqualTo(Outcome.DISCARDED);
    }

    // 기준: AI 명세 1.4 claims.extractFailed(주장을 기다리는 면접을 planStatus FAILED로 변경)
    @Test
    void claimExtractionFailureFailsOnlyWaitingSession() {
        InterviewSession waiting = newSession(InterviewMode.CHAT);
        Application application = waiting.getApplication();
        runtimes.startPlan(waiting.getId(), STARTED_AT.toInstant());
        InterviewSession planned = sessionOf(application, InterviewMode.CHAT);
        runtimes.startPlan(planned.getId(), STARTED_AT.toInstant());
        savePlan(planned);

        assertThat(results.handle(claimsExtractFailed(application.getId())))
                .isEqualTo(Outcome.SAVED);

        assertThat(runtimes.find(waiting.getId()).orElseThrow().planStatus())
                .isEqualTo(PlanStatus.FAILED);
        assertThat(runtimes.find(planned.getId()).orElseThrow().planStatus())
                .isEqualTo(PlanStatus.GENERATING);
    }

    // 다른 추출이 먼저 성공해 주장이 있으면, 그 뒤에 온 실패는 기다리는 면접을 실패시키지 않는다
    @Test
    void claimExtractionFailureAfterSavedClaimsIsDiscarded() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        long applicationId = session.getApplication().getId();
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());
        assertThat(results.handle(claimsExtracted(applicationId, "c1"))).isEqualTo(Outcome.SAVED);

        assertThat(results.handle(claimsExtractFailed(applicationId))).isEqualTo(Outcome.DISCARDED);
        assertThat(runtimes.find(session.getId()).orElseThrow().planStatus())
                .isEqualTo(PlanStatus.GENERATING);
    }

    // 질문 생성에 그대로 넣는 주장이라 AI가 작업에서 확인하는 칸(AI 명세 2장)이 틀리면 저장하지 않는다
    @Test
    void claimsResultWithoutApplicationOrWithBrokenClaimsIsInvalid() {
        long applicationId = newSession(InterviewMode.CHAT).getApplication().getId();
        String valid = claimsExtracted(applicationId, "c1");
        for (String raw :
                List.of(
                        valid.replace("\"applicationId\":" + applicationId + ",", ""),
                        "{\"type\":\"claims.extracted\",\"applicationId\":%d,\"claims\":[],\"promptVersion\":\"p\",\"modelVersion\":\"m\"}"
                                .formatted(applicationId),
                        valid.replace("\"type\":\"NUMBER\"", "\"type\":\"OPINION\""),
                        valid.replace("\"id\":\"c2\"", "\"id\":\"c1\""),
                        valid.replace("\"sentenceNo\":4", "\"sentenceNo\":0"),
                        valid.replace("\"text\":\"팀 갈등을 조율했다\"", "\"text\":\" \""),
                        valid.replace("\"id\":\"c2\"", "\"id\":\"" + "c".repeat(51) + "\""),
                        valid.replace(",\"promptVersion\":\"extract-claims-v1\"", ""))) {
            assertThatThrownBy(() -> results.handle(raw))
                    .as(raw)
                    .isInstanceOf(InvalidAiResultException.class);
        }
        assertThat(applicationClaims.existsByApplicationId(applicationId)).isFalse();
    }

    // 기준: AI 명세 2장 질문 보관함(개인 면접의 질문을 질문마다 한 행으로, 같은 결과를 두 번 받아도 한 번만) · 1.4(폐기한 결과는 보관함에도 넣지 않는다)
    @Test
    void personalPlanQuestionsAreKeptInQuestionPoolOnce() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());
        Map<String, Object> companyItem =
                Map.of("section", "market", "summary", "배송·결제 속도가 경쟁 요소", "quote", "…");
        String completed =
                planCompleted(session, 5)
                        .replace(
                                "\"criteria\":\"기준3\",\"claimId\":\"c1\"}",
                                "\"criteria\":\"기준3\",\"claimId\":\"c1\",\"companyItem\":{\"section\":\"market\",\"summary\":\"배송·결제"
                                    + " 속도가 경쟁 요소\",\"quote\":\"…\"}}");

        assertThat(results.handle(completed)).isEqualTo(Outcome.SAVED);
        assertThat(results.handle(completed)).isEqualTo(Outcome.DISCARDED);

        List<QuestionPoolItem> pool =
                poolItems.findByApplicationIdAndPersonaOrderById(
                        session.getApplication().getId(), Persona.DEVIL);
        assertThat(pool)
                .extracting(QuestionPoolItem::getContent)
                .containsExactly("질문1", "질문2", "질문3", "질문4", "질문5");
        assertThat(pool)
                .allSatisfy(
                        item -> {
                            assertThat(item.getClaimId()).isEqualTo("c1");
                            assertThat(item.getPromptVersion()).isEqualTo("plan-v1");
                            assertThat(item.getModelVersion()).isEqualTo("gms-test");
                        });
        assertThat(pool.get(2).getCriteria()).isEqualTo("기준3");
        assertThat(pool.get(2).getCompanyItem()).isEqualTo(companyItem);
        assertThat(pool.get(0).getCompanyItem()).isNull();
        // 면접 계획에도 연결 회사 항목이 남는다
        assertThat(plans.findById(session.getId()).orElseThrow().question(3).orElseThrow())
                .extracting(PlanQuestion::companyItem)
                .isEqualTo(companyItem);
    }

    // 기준: AI 명세 2장 출제 자리 배정(보관함에 넣은 뒤 오래된 미사용 질문부터 배정하고 배정한 질문의 버전으로 저장한다)
    @Test
    void personalPlanIsAssignedFromOldestUnusedPoolQuestions() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        Application application = session.getApplication();
        poolItem(application, "사용한 질문").markUsed(STARTED_AT);
        QuestionPoolItem older1 = poolItem(application, "예비1");
        QuestionPoolItem older2 = poolItem(application, "예비2");
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());

        assertThat(results.handle(planCompleted(session, 5))).isEqualTo(Outcome.SAVED);

        InterviewPlan plan = plans.findById(session.getId()).orElseThrow();
        assertThat(plan.getQuestions())
                .extracting(PlanQuestion::content)
                .containsExactly("예비1", "질문1", "예비2", "질문2", "질문3");
        assertThat(plan.getQuestions())
                .extracting(PlanQuestion::poolItemId)
                .doesNotContainNull()
                .contains(older1.getId(), older2.getId());
        assertThat(plan.getPromptVersion()).isEqualTo("plan-v1");
        assertThat(plan.getClaims()).extracting(PlanClaim::id).containsExactly("c1");
    }

    // 기준: AI 명세 2장 폐기(보관함에 넣기 전에 받은 결과와 프롬프트 버전이 다른 미사용 질문을 버린다)
    @Test
    void planCompletedDiscardsUnusedPoolQuestionsOfOtherPromptVersion() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        Application application = session.getApplication();
        poolItem(application, "이전 버전", "plan-v0");
        poolItem(application, "사용한 이전 버전", "plan-v0").markUsed(STARTED_AT);
        poolItem(application, "같은 버전");
        runtimes.startPlan(session.getId(), STARTED_AT.toInstant());

        assertThat(results.handle(planCompleted(session, 5))).isEqualTo(Outcome.SAVED);

        assertThat(
                        poolItems.findByApplicationIdAndPersonaOrderById(
                                application.getId(), Persona.DEVIL))
                .extracting(QuestionPoolItem::getContent)
                .containsExactly("사용한 이전 버전", "같은 버전", "질문1", "질문2", "질문3", "질문4", "질문5");
    }

    // 기준: AI 명세 2장 사용 처리(1·3번은 항상, 2·4·5번은 예비 질문을 출제했을 때만 보관함 질문이다)
    @Test
    void askedPoolQuestionsAreMarkedUsedButFollowUpSeatsAreNot() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        List<QuestionPoolItem> pool =
                IntStream.rangeClosed(1, 5)
                        .mapToObj(seq -> poolItem(session.getApplication(), "질문" + seq))
                        .toList();
        plans.save(assigner.assign(session, List.of()).orElseThrow());
        session.start(STARTED_AT.minusMinutes(1));
        em.flush();

        results.handle(questionStarted(session, 1));
        results.handle(questionStarted(session, 3));
        results.handle(questionStarted(session, 4));
        results.handle(
                """
                {"type":"question.started","sessionId":%d,"seq":2,
                 "startedAt":"2026-10-15T12:01:00+09:00","content":"꼬리질문2",
                 "criteria":"꼬리기준2","promptVersion":"followup-v2","modelVersion":"gms-test"}
                """
                        .formatted(session.getId()));

        // 3번 자리에는 1번 다음으로 오래된 보관함 질문이 간다
        assertThat(pool)
                .extracting(item -> item.getUsedAt() == null ? null : item.getUsedAt().toInstant())
                .containsExactly(
                        STARTED_AT.toInstant(),
                        STARTED_AT.toInstant(),
                        null,
                        STARTED_AT.toInstant(),
                        null);
    }

    @Test
    void lateOrGroupPlanQuestionsAreNotKeptInQuestionPool() {
        InterviewSession failed = newSession(InterviewMode.CHAT);
        runtimes.startPlan(failed.getId(), STARTED_AT.toInstant());
        runtimes.failPlanIfGenerating(failed.getId());
        InterviewSession group = groupSession();
        runtimes.startPlan(group.getId(), STARTED_AT.toInstant());

        assertThat(results.handle(planCompleted(failed, 5))).isEqualTo(Outcome.DISCARDED);
        assertThat(results.handle(planCompleted(group, InterviewPlan.GROUP_QUESTION_COUNT)))
                .isEqualTo(Outcome.SAVED);

        assertThat(
                        poolItems.findByApplicationIdAndPersonaOrderById(
                                failed.getApplication().getId(), Persona.DEVIL))
                .isEmpty();
        assertThat(
                        poolItems.findByApplicationIdAndPersonaOrderById(
                                group.getApplication().getId(), Persona.DEVIL))
                .isEmpty();
        assertThat(plans.existsById(group.getId())).isTrue();
    }

    @Test
    void questionStartedCreatesQuestionAtStartedTimeOnce() {
        InterviewSession session = startedSession(InterviewMode.CHAT);

        assertThat(results.handle(questionStarted(session, 2))).isEqualTo(Outcome.SAVED);
        InterviewQuestion question =
                questions.findBySessionIdAndSeq(session.getId(), 2).orElseThrow();
        assertThat(question.getContent()).isEqualTo("질문2");
        assertThat(question.getCriteria()).isEqualTo("기준2");
        assertThat(question.getPromptVersion()).isNull();
        assertThat(question.getModelVersion()).isNull();
        assertThat(question.getCreatedAt()).isEqualTo(STARTED_AT);

        assertThat(results.handle(questionStarted(session, 2))).isEqualTo(Outcome.DISCARDED);
    }

    // 기준: BE 파트 요청 2(첫 question.started 때 트랙 녹화가 모두 시작됐는지 확인)
    @Test
    void firstVideoQuestionSchedulesTrackRecordingCheckOnce() {
        InterviewSession video = startedSession(InterviewMode.VIDEO);

        assertThat(results.handle(questionStarted(video, 1))).isEqualTo(Outcome.SAVED);
        assertThat(results.handle(questionStarted(video, 2))).isEqualTo(Outcome.SAVED);
        // 같은 첫 질문이 다시 오면 버리고 다시 확인하지 않는다
        assertThat(results.handle(questionStarted(video, 1))).isEqualTo(Outcome.DISCARDED);

        // 방을 열 때와 같은 녹화 위치에 다시 요청하도록 시작 시각을 함께 넘긴다
        assertThat(events.stream(FirstQuestionStarted.class))
                .singleElement()
                .satisfies(
                        event -> {
                            assertThat(event.sessionId()).isEqualTo(video.getId());
                            assertThat(event.startedAt())
                                    .isAtSameInstantAs(STARTED_AT.minusMinutes(1));
                        });
    }

    @Test
    void chatQuestionDoesNotCheckTrackRecording() {
        InterviewSession chat = startedSession(InterviewMode.CHAT);

        assertThat(results.handle(questionStarted(chat, 1))).isEqualTo(Outcome.SAVED);

        assertThat(events.stream(FirstQuestionStarted.class)).isEmpty();
    }

    // 기준: AI 명세 1.4 · 6.5(시작 실패 뒤 다시 시작하면 이전 시도의 질문이 늦게 올 수 있다)
    @Test
    void questionStartedFromAttemptBeforeRestartIsDiscarded() {
        InterviewSession session = newSession(InterviewMode.VIDEO);
        savePlan(session);
        session.start(STARTED_AT.plusSeconds(1));
        em.flush();

        assertThat(results.handle(questionStarted(session, 1))).isEqualTo(Outcome.DISCARDED);
        assertThat(questions.findBySessionIdAndSeq(session.getId(), 1)).isEmpty();
    }

    // 기준: AI 명세 1.4·2.2, BE 설계 5.4(질문 행은 플랜이 아니라 실제로 출제한 질문의 글·채점 기준·버전으로 만든다)
    @Test
    void questionStartedSavesFollowUpQuestionAsAsked() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);

        assertThat(
                        results.handle(
                                """
                                {"type":"question.started","sessionId":%d,"seq":2,
                                 "startedAt":"2026-10-15T12:01:00+09:00","content":"꼬리질문2",
                                 "criteria":"꼬리기준2","promptVersion":"followup-v1",
                                 "modelVersion":"gms-test"}
                                """
                                        .formatted(session.getId())))
                .isEqualTo(Outcome.SAVED);

        InterviewQuestion question =
                questions.findBySessionIdAndSeq(session.getId(), 2).orElseThrow();
        assertThat(question.getContent()).isEqualTo("꼬리질문2");
        assertThat(question.getCriteria()).isEqualTo("꼬리기준2");
        assertThat(question.getPromptVersion()).isEqualTo("followup-v1");
        assertThat(question.getModelVersion()).isEqualTo("gms-test");
    }

    @Test
    void questionStartedWithoutContentOrCriteriaIsInvalid() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);

        for (String fields :
                List.of(
                        "\"criteria\":\"기준1\"",
                        "\"content\":\" \",\"criteria\":\"기준1\"",
                        "\"content\":\"질문1\"",
                        "\"content\":\"질문1\",\"criteria\":\"\"")) {
            String raw =
                    "{\"type\":\"question.started\",\"sessionId\":%d,\"seq\":1,"
                                    .formatted(session.getId())
                            + "\"startedAt\":\"2026-10-15T12:01:00+09:00\","
                            + fields
                            + "}";
            assertThatThrownBy(() -> results.handle(raw))
                    .as(raw)
                    .isInstanceOf(InvalidAiResultException.class);
        }
        assertThat(questions.findBySessionIdAndSeq(session.getId(), 1)).isEmpty();
    }

    @Test
    void questionStartedBeforeStartIsDiscarded() {
        InterviewSession session = newSession(InterviewMode.CHAT);
        savePlan(session);

        assertThat(results.handle(questionStarted(session, 1))).isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void videoAnswerIsSavedOnceAndScoringIsQueued() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);
        results.handle(questionStarted(session, 1));

        assertThat(results.handle(answerCompleted(session, 1, "조회 쿼리를"))).isEqualTo(Outcome.SAVED);
        Answer answer = answers.findWithQuestionBySessionId(session.getId()).getFirst();
        assertThat(answer.getInputType()).isEqualTo(InputType.VOICE);
        assertThat(answer.getContent()).isEqualTo("조회 쿼리를");
        assertThat(answer.getTokens()).hasSize(1);
        assertThat(answer.getSpeech()).isEqualTo(new AnswerSpeech(12.5, null));
        assertThat(answer.getSttGaps()).isNull();
        assertThat(answer.getStartedAt())
                .isEqualTo(OffsetDateTime.parse("2026-10-15T12:01:05.250+09:00"));
        assertThat(jobs.findAll())
                .anyMatch(
                        job ->
                                job.getJobType() == AiJobType.SCORE_ANSWER
                                        && job.getAnswerId().equals(answer.getId()));

        assertThat(results.handle(answerCompleted(session, 1, "다시"))).isEqualTo(Outcome.DISCARDED);
    }

    @Test
    void timelineValuesAreSavedWithAnswer() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);
        results.handle(questionStarted(session, 1));

        assertThat(results.handle(answerCompletedWithTimeline(session, TIMELINE)))
                .isEqualTo(Outcome.SAVED);

        AnswerSpeech speech =
                answers.findWithQuestionBySessionId(session.getId()).getFirst().getSpeech();
        assertThat(speech.trailingOffAtMs()).containsExactly(9120);
        assertThat(speech.impressions().promptVersion()).isEqualTo("impression-v1");
        assertThat(speech.impressions().items())
                .containsExactly(
                        new AnswerImpressions.Item(1500, 0.98, 62.5, 70.1, 55.0, null, 66.0, 71.2));
    }

    @Test
    void invalidTimelineValuesAreDroppedButAnswerIsSaved() {
        // 타임라인 값은 저장만 하고 채점에 쓰지 않으므로, 범위를 벗어난 값만 버리고 답변은 저장한다
        Map<String, Boolean> timesKept =
                Map.of(
                        TIMELINE.replace("[9120]", "[-1]"), false,
                        TIMELINE.replace("\"atMs\":1500", "\"atMs\":-1"), true,
                        TIMELINE.replace("\"face\":0.98", "\"face\":1.5"), true,
                        TIMELINE.replace("\"trust\":71.2", "\"trust\":100.1"), true,
                        TIMELINE.replace("\"impression-v1\"", "\"\""), true);
        timesKept.forEach(
                (timeline, kept) -> {
                    InterviewSession session = startedSession(InterviewMode.VIDEO);
                    results.handle(questionStarted(session, 1));

                    assertThat(results.handle(answerCompletedWithTimeline(session, timeline)))
                            .as(timeline)
                            .isEqualTo(Outcome.SAVED);

                    AnswerSpeech speech =
                            answers.findWithQuestionBySessionId(session.getId())
                                    .getFirst()
                                    .getSpeech();
                    assertThat(speech.trailingOffRatio()).isEqualTo(12.5);
                    assertThat(speech.trailingOffAtMs() != null).as(timeline).isEqualTo(kept);
                    // 시각만 틀린 경우는 인상이 남고, 인상이 틀린 경우는 인상만 버린다
                    assertThat(speech.impressions() != null).as(timeline).isEqualTo(!kept);
                });
    }

    @Test
    void sttGapsAreSavedWithAnswer() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);
        results.handle(questionStarted(session, 1));

        assertThat(
                        results.handle(
                                answerCompletedWithSttGaps(
                                        session,
                                        "[{\"startMs\":21400,\"endMs\":23950},"
                                                + "{\"startMs\":30000,\"endMs\":30000}]")))
                .isEqualTo(Outcome.SAVED);

        assertThat(answers.findWithQuestionBySessionId(session.getId()).getFirst().getSttGaps())
                .containsExactly(new SttGap(21400, 23950), new SttGap(30000, 30000));
    }

    @Test
    void invalidSttGapsAreDroppedButAnswerIsSaved() {
        // 끊긴 구간이 틀려도 답변은 남긴다. 채점은 끊긴 구간 없이 한다(AI 명세 6.2)
        for (String gaps :
                List.of(
                        "[{\"startMs\":-1,\"endMs\":100}]",
                        "[{\"startMs\":500,\"endMs\":100}]",
                        "[{\"startMs\":3000,\"endMs\":4000},{\"startMs\":1000,\"endMs\":2000}]",
                        "[null]",
                        "[]")) {
            InterviewSession session = startedSession(InterviewMode.VIDEO);
            results.handle(questionStarted(session, 1));

            assertThat(results.handle(answerCompletedWithSttGaps(session, gaps)))
                    .as(gaps)
                    .isEqualTo(Outcome.SAVED);

            Answer answer = answers.findWithQuestionBySessionId(session.getId()).getFirst();
            assertThat(answer.getContent()).isEqualTo("답");
            assertThat(answer.getSttGaps()).as(gaps).isNull();
        }
    }

    @Test
    void answerCompletedForChatOrUnaskedQuestionIsDiscarded() {
        InterviewSession chat = startedSession(InterviewMode.CHAT);
        results.handle(questionStarted(chat, 1));
        assertThat(results.handle(answerCompleted(chat, 1, "답"))).isEqualTo(Outcome.DISCARDED);

        InterviewSession video = startedSession(InterviewMode.VIDEO);
        assertThat(results.handle(answerCompleted(video, 3, "답"))).isEqualTo(Outcome.DISCARDED);
        String blankAnswer = answerCompleted(video, 1, " ");
        assertThatThrownBy(() -> results.handle(blankAnswer))
                .isInstanceOf(InvalidAiResultException.class);
    }

    @Test
    void answerCompletedOutOfRangeIsInvalid() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);
        results.handle(questionStarted(session, 1));
        String valid = answerCompleted(session, 1, "답");

        for (String raw :
                List.of(
                        answerCompleted(session, 1, "가".repeat(10_001)),
                        valid.replace("\"startMs\":0", "\"startMs\":-1"),
                        valid.replace("\"endMs\":280", "\"endMs\":-5"),
                        valid.replace(
                                "\"answerStartedAt\":\"2026-10-15T12:01:05.250+09:00\",", ""))) {
            assertThatThrownBy(() -> results.handle(raw))
                    .as(raw)
                    .isInstanceOf(InvalidAiResultException.class);
        }
        assertThat(answers.findWithQuestionBySessionId(session.getId())).isEmpty();
        // 10,000자는 저장한다
        assertThat(results.handle(answerCompleted(session, 1, "가".repeat(10_000))))
                .isEqualTo(Outcome.SAVED);
    }

    @Test
    void firstScoreIsKeptAndOtherSessionIsDiscarded() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);
        results.handle(questionStarted(session, 1));
        results.handle(answerCompleted(session, 1, "답"));
        long answerId = answers.findWithQuestionBySessionId(session.getId()).getFirst().getId();

        assertThat(results.handle(answerScored(session.getId(), answerId, "PROBABILITY")))
                .isEqualTo(Outcome.SAVED);
        assertThat(results.handle(answerScored(session.getId(), answerId, "FIXED")))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(results.handle(answerScored(session.getId() + 1_000, answerId, "FIXED")))
                .isEqualTo(Outcome.DISCARDED);
        em.flush();
        em.clear();
        assertThat(answers.findById(answerId).orElseThrow().getEvaluation())
                .containsEntry("scoreMethod", "PROBABILITY");
    }

    @Test
    void assignmentRejectedBeforeFirstQuestionFailsStartOnce() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);

        assertThat(
                        results.handle(
                                assignmentRejected(
                                        session, "INVALID_ASSIGNMENT", afterStart(session))))
                .isEqualTo(Outcome.SAVED);
        assertThat(session.getStatus()).isEqualTo(SessionStatus.START_FAILED);
        verify(rooms).close(session.getId());

        // 같은 메시지가 다시 오면 버린다
        assertThat(
                        results.handle(
                                assignmentRejected(
                                        session, "INVALID_ASSIGNMENT", afterStart(session))))
                .isEqualTo(Outcome.DISCARDED);
    }

    // 기준: AI 명세 1.4 · 6.5(지원자가 모두 떠나 LiveKit이 방을 닫으면 끝내기 5.8과 같이 끝낸다)
    @Test
    void roomClosedEndsInterviewLikeUserEnd() {
        // 답변이 있으면 결과를 만든다
        InterviewSession answered = startedSession(InterviewMode.VIDEO);
        results.handle(questionStarted(answered, 1));
        results.handle(answerCompleted(answered, 1, "조회 쿼리를"));
        assertThat(results.handle(roomClosed(answered, afterStart(answered))))
                .isEqualTo(Outcome.SAVED);
        assertThat(answered.getStatus()).isEqualTo(SessionStatus.ANALYZING);
        // 같은 메시지가 다시 오면 버린다
        assertThat(results.handle(roomClosed(answered, afterStart(answered))))
                .isEqualTo(Outcome.DISCARDED);

        // 답변이 없으면 ABORTED다
        InterviewSession unanswered = startedSession(InterviewMode.CHAT);
        assertThat(results.handle(roomClosed(unanswered, afterStart(unanswered))))
                .isEqualTo(Outcome.SAVED);
        assertThat(unanswered.getStatus()).isEqualTo(SessionStatus.ABORTED);
    }

    @Test
    void roomClosedBeforeRestartOrBeforeStartIsDiscarded() {
        // 다시 시작(5.4)하기 전 시도의 방이 닫힌 것이 늦게 왔다
        InterviewSession restarted = startedSession(InterviewMode.VIDEO);
        assertThat(results.handle(roomClosed(restarted, restarted.getStartedAt().minusSeconds(1))))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(restarted.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);

        // 시작 전이면 버린다
        InterviewSession ready = newSession(InterviewMode.VIDEO);
        assertThat(results.handle(roomClosed(ready, STARTED_AT))).isEqualTo(Outcome.DISCARDED);
        assertThat(ready.getStatus()).isEqualTo(SessionStatus.READY);

        // 닫힌 시각이 없으면 처리할 수 없다
        String withoutClosedAt =
                "{\"type\":\"room.closed\",\"sessionId\":%d}".formatted(restarted.getId());
        assertThatThrownBy(() -> results.handle(withoutClosedAt))
                .isInstanceOf(InvalidAiResultException.class);
    }

    @Test
    void assignmentRejectedAfterQuestionOrBeforeRestartIsDiscarded() {
        // 질문을 낸 뒤에는 배정이 이미 된 것이다
        InterviewSession asked = startedSession(InterviewMode.CHAT);
        results.handle(questionStarted(asked, 1));
        assertThat(
                        results.handle(
                                assignmentRejected(asked, "INVALID_ASSIGNMENT", afterStart(asked))))
                .isEqualTo(Outcome.DISCARDED);
        assertThat(asked.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);

        // 다시 시작하기 전에 보낸 거절이 늦게 왔다
        InterviewSession restarted = startedSession(InterviewMode.CHAT);
        String late =
                assignmentRejected(
                        restarted, "INVALID_ASSIGNMENT", restarted.getStartedAt().minusSeconds(1));
        assertThat(results.handle(late)).isEqualTo(Outcome.DISCARDED);
        assertThat(restarted.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);

        // 시작 전이면 버린다
        InterviewSession ready = newSession(InterviewMode.CHAT);
        assertThat(results.handle(assignmentRejected(ready, "INVALID_ASSIGNMENT", STARTED_AT)))
                .isEqualTo(Outcome.DISCARDED);
        verify(rooms, never()).close(anyLong());
    }

    @Test
    void assignmentRejectedWithoutReasonOrTimeIsInvalid() {
        InterviewSession session = startedSession(InterviewMode.VIDEO);
        String valid = assignmentRejected(session, "INVALID_ASSIGNMENT", afterStart(session));

        for (String raw :
                List.of(
                        valid.replace("INVALID_ASSIGNMENT", "BUSY"),
                        // 에이전트가 더 이상 보내지 않는 이유(AI 명세 1.4)
                        valid.replace("INVALID_ASSIGNMENT", "CAPACITY_EXCEEDED"),
                        valid.replace("\"reason\":\"INVALID_ASSIGNMENT\",", ""),
                        valid.replaceAll(",\"occurredAt\":\"[^\"]+\"", ""))) {
            assertThatThrownBy(() -> results.handle(raw))
                    .as(raw)
                    .isInstanceOf(InvalidAiResultException.class);
        }
        assertThat(session.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
    }

    @Test
    void unreadableMessagesAreInvalid() {
        for (String raw :
                List.of(
                        "not json",
                        "{\"type\":\"plan.progress\",\"progress\":50}",
                        "{\"type\":\"unknown.type\",\"sessionId\":1}",
                        "{\"type\":\"plan.progress\",\"sessionId\":1}",
                        "{\"type\":\"question.started\",\"sessionId\":1,\"seq\":6,"
                                + "\"startedAt\":\"2026-10-15T12:01:00+09:00\"}")) {
            assertThatThrownBy(() -> results.handle(raw))
                    .as(raw)
                    .isInstanceOf(InvalidAiResultException.class);
        }
    }

    private InterviewSession newSession(InterviewMode mode) {
        User user = new User("ai-result-" + UUID.randomUUID() + "@example.com", "hash", "결과");
        em.persist(user);
        Application application = new Application(user, "○○전자", "백엔드 개발자");
        em.persist(application);
        InterviewSession session = new InterviewSession(user, application, Persona.DEVIL, mode);
        em.persist(session);
        em.flush();
        return session;
    }

    // 결과 메시지의 시각(STARTED_AT)보다 먼저 시작한다. 시작 시각보다 이른 질문은 버리기 때문이다
    private InterviewSession startedSession(InterviewMode mode) {
        InterviewSession session = newSession(mode);
        savePlan(session);
        session.start(STARTED_AT.minusMinutes(1));
        em.flush();
        return session;
    }

    // 같은 지원서로 만든 다른 개인 면접
    private InterviewSession sessionOf(Application application, InterviewMode mode) {
        InterviewSession session =
                new InterviewSession(application.getUser(), application, Persona.DEVIL, mode);
        em.persist(session);
        em.flush();
        return session;
    }

    private InterviewSession groupSession() {
        User host = new User("ai-result-" + UUID.randomUUID() + "@example.com", "hash", "방장");
        em.persist(host);
        InterviewGroup group =
                new InterviewGroup(
                        host,
                        InterviewMode.CHAT,
                        Persona.DEVIL,
                        JobCategory.DEVELOPMENT,
                        2,
                        UUID.randomUUID().toString().substring(0, 6));
        em.persist(group);
        Application application = new Application(host, "○○전자", "백엔드 개발자");
        em.persist(application);
        InterviewSession session =
                InterviewSession.ofGroup(
                        host, application, null, Persona.DEVIL, InterviewMode.CHAT, group.getId());
        em.persist(session);
        em.flush();
        return session;
    }

    private List<AiJob> planJobs(InterviewSession session) {
        return jobs.findAll().stream()
                .filter(
                        job ->
                                job.getJobType() == AiJobType.PLAN
                                        && session.getId().equals(job.getSessionId()))
                .toList();
    }

    // 주장 2개. firstId로 첫 주장의 id를 바꿔 다른 추출 결과를 만든다
    private static String claimsExtracted(long applicationId, String firstId) {
        return """
        {"type":"claims.extracted","applicationId":%d,"jobId":"j1",
         "claims":[{"id":"%s","text":"조회 응답 시간을 40%% 줄였다","type":"NUMBER","sentenceNo":4,"talentCriteria":["실행·성과"]},{"id":"c2","text":"팀 갈등을 조율했다","type":"EXPERIENCE","sentenceNo":7,"talentCriteria":[]}],"promptVersion":"extract-claims-v1","modelVersion":"gms-test"}
        """
                .formatted(applicationId, firstId);
    }

    private static String claimsExtractFailed(long applicationId) {
        return """
        {"type":"claims.extractFailed","applicationId":%d,"jobId":"j1","reason":"INVALID_OUTPUT"}
        """
                .formatted(applicationId);
    }

    private QuestionPoolItem poolItem(Application application, String content) {
        return poolItem(application, content, "plan-v1");
    }

    private QuestionPoolItem poolItem(
            Application application, String content, String promptVersion) {
        QuestionPoolItem item =
                new QuestionPoolItem(
                        application,
                        Persona.DEVIL,
                        new PlanQuestion(1, content, "기준", "c1", null, null),
                        promptVersion,
                        "gms-test");
        em.persist(item);
        return item;
    }

    private void savePlan(InterviewSession session) {
        plans.save(
                new InterviewPlan(
                        session.getId(),
                        List.of(new PlanClaim("c1", "주장", "NUMBER", 1, null)),
                        IntStream.rangeClosed(1, 5)
                                .mapToObj(
                                        seq ->
                                                new PlanQuestion(
                                                        seq,
                                                        "질문" + seq,
                                                        "기준" + seq,
                                                        "c1",
                                                        null,
                                                        null))
                                .toList(),
                        "plan-v1",
                        "gms-test"));
        em.flush();
    }

    private static String planProgress(InterviewSession session, int progress) {
        return """
        {"type":"plan.progress","sessionId":%d,"jobId":"j1","progress":%d}
        """
                .formatted(session.getId(), progress);
    }

    private static String planCompleted(InterviewSession session, int questionCount) {
        StringBuilder questionsJson = new StringBuilder();
        for (int seq = 1; seq <= questionCount; seq++) {
            questionsJson
                    .append(seq == 1 ? "" : ",")
                    .append(
                            """
                            {"seq":%d,"content":"질문%d","criteria":"기준%d","claimId":"c1"}
                            """
                                    .formatted(seq, seq, seq)
                                    .strip());
        }
        return """
        {"type":"plan.completed","sessionId":%d,"jobId":"j1",
         "claims":[{"id":"c1","text":"주장","type":"NUMBER","sentenceNo":1}],
         "questions":[%s],"promptVersion":"plan-v1","modelVersion":"gms-test"}
        """
                .formatted(session.getId(), questionsJson);
    }

    private static String planFailed(InterviewSession session) {
        return """
        {"type":"plan.failed","sessionId":%d,"jobId":"j1","reason":"GMS 실패"}
        """
                .formatted(session.getId());
    }

    private static String questionStarted(InterviewSession session, int seq) {
        return """
        {"type":"question.started","sessionId":%d,"seq":%d,
         "startedAt":"2026-10-15T12:01:00+09:00","content":"질문%d","criteria":"기준%d"}
        """
                .formatted(session.getId(), seq, seq, seq);
    }

    private static String answerCompleted(InterviewSession session, int seq, String content) {
        return """
        {"type":"answer.completed","sessionId":%d,"seq":%d,
         "answerStartedAt":"2026-10-15T12:01:05.250+09:00","content":"%s",
         "tokens":[{"text":"조회","startMs":0,"endMs":280}],
         "speech":{"trailingOffRatio":12.5,"pitchRangeSt":null},"endReason":"AUTO_SUBMIT"}
        """
                .formatted(session.getId(), seq, content);
    }

    // AI 명세 6.2 answer.completed 예시의 타임라인 값(emotion은 받지 못한 점수)
    private static final String TIMELINE =
            """
            "trailingOffAtMs":[9120],
            "impressions":{"promptVersion":"impression-v1","modelVersion":"jev-1.14.0",
             "items":[{"atMs":1500,"face":0.98,"stability":62.5,"confidence":70.1,
                       "expression":55.0,"emotion":null,"likeability":66.0,"trust":71.2}]}
            """;

    private static String answerCompletedWithTimeline(InterviewSession session, String timeline) {
        return """
        {"type":"answer.completed","sessionId":%d,"seq":1,
         "answerStartedAt":"2026-10-15T12:01:05.250+09:00","content":"답",
         "tokens":[{"text":"조회","startMs":0,"endMs":280}],
         "speech":{"trailingOffRatio":12.5,"pitchRangeSt":null,%s},"endReason":"AUTO_SUBMIT"}
        """
                .formatted(session.getId(), timeline);
    }

    // AI 명세 6.2 answer.completed 예시처럼 STT를 다시 연결하지 못해 제출한 답변
    private static String answerCompletedWithSttGaps(InterviewSession session, String sttGaps) {
        return """
        {"type":"answer.completed","sessionId":%d,"seq":1,
         "answerStartedAt":"2026-10-15T12:01:05.250+09:00","content":"답",
         "tokens":[{"text":"조회","startMs":0,"endMs":280}],
         "speech":null,"sttGaps":%s,"endReason":"STT_FAILED"}
        """
                .formatted(session.getId(), sttGaps);
    }

    private static String answerScored(long sessionId, long answerId, String scoreMethod) {
        return """
        {"type":"answer.scored","sessionId":%d,"jobId":"j2","answerId":%d,
         "evaluation":{"scoreMethod":"%s","criteria":{}}}
        """
                .formatted(sessionId, answerId, scoreMethod);
    }

    private static OffsetDateTime afterStart(InterviewSession session) {
        return session.getStartedAt().plusSeconds(1);
    }

    private static String roomClosed(InterviewSession session, OffsetDateTime occurredAt) {
        return """
        {"type":"room.closed","sessionId":%d,"occurredAt":"%s"}
        """
                .formatted(session.getId(), occurredAt);
    }

    private static String assignmentRejected(
            InterviewSession session, String reason, OffsetDateTime occurredAt) {
        return """
        {"type":"assignment.rejected","sessionId":%d,"reason":"%s","occurredAt":"%s"}
        """
                .formatted(session.getId(), reason, occurredAt);
    }
}
