package com.ssafy.a301;

import static com.ssafy.a301.TestEntities.T0;
import static com.ssafy.a301.TestEntities.withId;
import static org.assertj.core.api.Assertions.assertThat;

import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.domain.GrantStatus;
import com.ssafy.a301.admin.domain.GrantTarget;
import com.ssafy.a301.admin.domain.Notice;
import com.ssafy.a301.admin.domain.StreakFreezeGrant;
import com.ssafy.a301.admin.mapper.AdminMapper;
import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.mapper.ApplicationMapper;
import com.ssafy.a301.growth.mapper.GrowthMapper;
import com.ssafy.a301.home.mapper.HomeMapper;
import com.ssafy.a301.interview.domain.AnalysisStep;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.Grade;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.PlanStatus;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.interview.dto.InterviewDtos.CriterionGrade;
import com.ssafy.a301.interview.dto.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.mapper.InterviewMapper;
import com.ssafy.a301.practice.domain.PracticeLog;
import com.ssafy.a301.result.dto.ResultDtos;
import com.ssafy.a301.result.dto.ResultDtos.ReplayResponse;
import com.ssafy.a301.result.dto.ResultDtos.ResultResponse;
import com.ssafy.a301.result.mapper.ResultMapper;
import com.ssafy.a301.result.mapper.ResultMapper.QuestionAndAnswer;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.mapper.UserMapper;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 엔티티 → 응답 DTO 변환이 명세의 값 규칙(상태별 null, 정렬, 3단계)을 따르는지 확인한다. */
class MapperTest {

    private final User user = withId(new User("a@ssafy.com", "hash", "면접왕"), 1);
    private final Application application = withId(new Application(user, "○○전자", "백엔드 개발자"), 10);

    private InterviewSession session(InterviewMode mode) {
        return withId(new InterviewSession(user, application, Persona.DEVIL, mode), 55);
    }

    @Test
    void userResponseHasStreakAndImageUrl() {
        var me = UserMapper.toMe(user, null, null, "https://img", 7);
        assertThat(me.id()).isEqualTo(1);
        assertThat(me.currentStreak()).isEqualTo(7);
        assertThat(me.profileImageUrl()).isEqualTo("https://img");
        assertThat(me.createdAt()).isEqualTo(T0);
    }

    @Test
    void applicationResponseHasItemsInOrderAndListItemHasNone() {
        application.addCoverLetterItem("지원 동기", "저는…");
        application.addCoverLetterItem("협업 경험", "함께했습니다.");

        assertThat(ApplicationMapper.toResponse(application).coverLetterItems())
                .extracting("itemOrder", "question")
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(1, "지원 동기"),
                        org.assertj.core.groups.Tuple.tuple(2, "협업 경험"));
        assertThat(ApplicationMapper.toListItem(application).companyName()).isEqualTo("○○전자");
    }

    @Test
    void sessionResponseFillsOnlyValuesForItsStatus() {
        InterviewSession s = session(InterviewMode.VIDEO);
        var question = withId(new InterviewQuestion(s, 1, "자기소개"), 301);

        SessionResponse ready =
                InterviewMapper.toSessionResponse(
                        s,
                        new SessionRuntime(PlanStatus.GENERATING, 78, null, 0),
                        null,
                        0,
                        T0,
                        null);
        assertThat(ready.planProgress()).isEqualTo(78);
        assertThat(ready.currentQuestion()).isNull();
        assertThat(ready.elapsedSeconds()).isZero();
        assertThat(ready.leveledUp()).isNull();

        s.start(T0);
        SessionResponse inProgress =
                InterviewMapper.toSessionResponse(
                        s,
                        new SessionRuntime(PlanStatus.READY, 50, AnalysisStep.SCORING, 0),
                        question,
                        0,
                        T0.plusSeconds(10),
                        null);
        assertThat(inProgress.planProgress()).isNull();
        assertThat(inProgress.analysisStep()).isNull();
        assertThat(inProgress.currentQuestion().id()).isEqualTo(301);
        assertThat(inProgress.companyName()).isEqualTo("○○전자");
        assertThat(inProgress.elapsedSeconds()).isEqualTo(10);

        s.end(T0.plusSeconds(60), 1);
        SessionResponse analyzing =
                InterviewMapper.toSessionResponse(
                        s,
                        new SessionRuntime(PlanStatus.READY, null, AnalysisStep.SCORING, 0),
                        question,
                        1,
                        T0.plusSeconds(90),
                        true);
        assertThat(analyzing.analysisStep()).isEqualTo(AnalysisStep.SCORING);
        assertThat(analyzing.currentQuestion()).isNull();
        assertThat(analyzing.leveledUp()).isTrue();
    }

    @Test
    void resultHasAnsweredQuestionsOnlyAndReplayHasAll() {
        InterviewSession s = session(InterviewMode.CHAT);
        s.start(T0);
        var q1 = withId(new InterviewQuestion(s, 1, "자기소개"), 301);
        var q2 = withId(new InterviewQuestion(s, 2, "역할은?"), 302);
        var a1 = withId(new Answer(q1, InputType.TEXT, "안녕하세요"), 901);
        a1.evaluate(85, "좋음", "아쉬움");
        s.end(T0.plusMinutes(5), 1);
        s.complete("총평", "다음에 해볼 것");
        List<QuestionAndAnswer> items =
                List.of(new QuestionAndAnswer(q2, null), new QuestionAndAnswer(q1, a1));

        ResultResponse result =
                ResultMapper.toResult(
                        s, List.of(new SessionScore(s, Criterion.LOGIC, 58, "근거부터")), items, null);
        assertThat(result.sessionScores().getFirst().grade()).isEqualTo(Grade.WEAK);
        assertThat(result.answers()).hasSize(1);
        assertThat(result.answers().getFirst().grade()).isEqualTo(Grade.GOOD);
        assertThat(result.speechMetrics()).isNull();

        ReplayResponse replay =
                ResultMapper.toReplay(
                        s, items, ResultDtos.VideoStatus.READY, "https://video", T0.plusSeconds(3));
        assertThat(replay.items()).extracting(ResultDtos.ReplayItem::seq).containsExactly(1, 2);
        assertThat(replay.items().get(1).answer()).isNull();
        // 채팅은 녹화가 없다
        assertThat(replay.videoStatus()).isNull();
        assertThat(replay.videoUrl()).isNull();
        assertThat(replay.recordingStartedAt()).isNull();
    }

    @Test
    void videoResultHasSpeechMetricsAndVideoUrl() {
        InterviewSession s = session(InterviewMode.VIDEO);
        s.start(T0);
        s.end(T0.plusMinutes(5), 1);
        s.complete("총평", "다음에 해볼 것");
        SpeechMetric metric = new SpeechMetric(s, new BigDecimal("2.10"), 3, null, null, null);

        ResultResponse result = ResultMapper.toResult(s, List.of(), List.of(), metric);
        assertThat(result.speechMetrics().longPauseCount()).isEqualTo(3);
        assertThat(result.speechMetrics().gazeRatio()).isNull();
        ReplayResponse replay =
                ResultMapper.toReplay(
                        s,
                        List.of(),
                        ResultDtos.VideoStatus.READY,
                        "https://video",
                        T0.plusSeconds(3));
        assertThat(replay.videoStatus()).isEqualTo(ResultDtos.VideoStatus.READY);
        assertThat(replay.videoUrl()).isEqualTo("https://video");
        assertThat(replay.startedAt()).isEqualTo(T0);
        assertThat(replay.recordingStartedAt()).isEqualTo(T0.plusSeconds(3));
    }

    // AI 명세 4장 answers[].evaluation.timeline(답변 기준 밀리초)
    private static Map<String, Object> aiTimeline(String metric) {
        Map<String, Object> filler = new HashMap<>();
        filler.put("metric", "FILLER");
        filler.put("count", 3);
        filler.put("text", "멈춰도 돼요.");
        Map<String, Object> checkpoint =
                Map.of(
                        "atMs", 1000,
                        "startMs", 1000,
                        "endMs", 1000,
                        "value", -2.1,
                        "reasons", List.of(Map.of("metric", metric, "text", "고개를 드세요."), filler));
        return Map.of(
                "timeline",
                Map.of(
                        "points",
                        List.of(
                                Map.of("atMs", 0, "value", 0.4),
                                Map.of("atMs", 1000, "value", -2.1)),
                        "checkpoints",
                        List.of(checkpoint)));
    }

    @Test
    void videoReplayTimelineIsMovedToVideoSeconds() {
        // 영상 0초 시각이 없으면(이어 붙여 합침 · V19 전 녹화) 면접 시작 일시가 0초다(API 명세 6.4)
        InterviewSession s = session(InterviewMode.VIDEO);
        s.start(T0);
        var q1 = withId(new InterviewQuestion(s, 1, "자기소개"), 301);
        var a1 =
                withId(
                        Answer.voice(
                                q1, "안녕하세요", null, null, T0.plusSeconds(84).plusNanos(250_000_000)),
                        901);
        a1.completeEvaluation(85, "좋음", "아쉬움", aiTimeline("CONFIDENCE"));

        ResultDtos.ReplayTimeline timeline =
                ResultMapper.toReplay(s, List.of(new QuestionAndAnswer(q1, a1)), null, null, null)
                        .items()
                        .getFirst()
                        .timeline();

        assertThat(timeline.points())
                .containsExactly(
                        new ResultDtos.TimelinePoint(84.25, 0.4),
                        new ResultDtos.TimelinePoint(85.25, -2.1));
        assertThat(timeline.checkpoints())
                .containsExactly(
                        new ResultDtos.TimelineCheckpoint(
                                85.25,
                                85.25,
                                85.25,
                                -2.1,
                                List.of(
                                        new ResultDtos.TimelineReason(
                                                "CONFIDENCE", null, "고개를 드세요."),
                                        new ResultDtos.TimelineReason("FILLER", 3, "멈춰도 돼요."))));
    }

    @Test
    void videoReplayTimelineStartsAtRecordingStartedAt() {
        // 영상 위치 = (답변을 듣기 시작한 일시 - 영상 0초 시각) + 답변 기준 밀리초(API 명세 6.4)
        InterviewSession s = session(InterviewMode.VIDEO);
        s.start(T0);
        var q1 = withId(new InterviewQuestion(s, 1, "자기소개"), 301);
        var a1 =
                withId(
                        Answer.voice(
                                q1, "안녕하세요", null, null, T0.plusSeconds(84).plusNanos(250_000_000)),
                        901);
        a1.completeEvaluation(85, "좋음", "아쉬움", aiTimeline("CONFIDENCE"));

        ResultDtos.ReplayTimeline timeline =
                ResultMapper.toReplay(
                                s,
                                List.of(new QuestionAndAnswer(q1, a1)),
                                ResultDtos.VideoStatus.READY,
                                "https://video",
                                T0.plusSeconds(3).plusNanos(120_000_000))
                        .items()
                        .getFirst()
                        .timeline();

        assertThat(timeline.points())
                .extracting(ResultDtos.TimelinePoint::at)
                .containsExactly(81.13, 82.13);
        assertThat(timeline.checkpoints())
                .singleElement()
                .satisfies(
                        c -> {
                            assertThat(c.at()).isEqualTo(82.13);
                            assertThat(c.start()).isEqualTo(82.13);
                            assertThat(c.end()).isEqualTo(82.13);
                        });
    }

    @Test
    void brokenMissingOrChatReplayTimelineIsNull() {
        // 저장만 하는 부가 값이라 형식이 틀리면 그 답변의 타임라인만 null로 둔다
        InterviewSession s = session(InterviewMode.VIDEO);
        s.start(T0);
        var q1 = withId(new InterviewQuestion(s, 1, "자기소개"), 301);
        var broken = withId(Answer.voice(q1, "답", null, null, T0.plusSeconds(5)), 901);
        broken.completeEvaluation(85, "좋음", "아쉬움", aiTimeline("UNKNOWN"));
        var q2 = withId(new InterviewQuestion(s, 2, "역할은?"), 302);
        var noTimeline = withId(Answer.voice(q2, "답", null, null, T0.plusSeconds(60)), 902);
        noTimeline.completeEvaluation(85, "좋음", "아쉬움", Map.of());
        var q3 = withId(new InterviewQuestion(s, 3, "장점은?"), 303);

        ReplayResponse replay =
                ResultMapper.toReplay(
                        s,
                        List.of(
                                new QuestionAndAnswer(q1, broken),
                                new QuestionAndAnswer(q2, noTimeline),
                                new QuestionAndAnswer(q3, null)),
                        null,
                        null,
                        null);
        assertThat(replay.items()).allSatisfy(item -> assertThat(item.timeline()).isNull());

        InterviewSession chat = session(InterviewMode.CHAT);
        chat.start(T0);
        var cq = withId(new InterviewQuestion(chat, 1, "자기소개"), 401);
        var ca = withId(new Answer(cq, InputType.TEXT, "안녕하세요"), 991);
        ca.completeEvaluation(85, "좋음", "아쉬움", aiTimeline("CONFIDENCE"));
        assertThat(
                        ResultMapper.toReplay(
                                        chat,
                                        List.of(new QuestionAndAnswer(cq, ca)),
                                        null,
                                        null,
                                        null)
                                .items()
                                .getFirst()
                                .timeline())
                .isNull();
    }

    @Test
    void sessionListItemHasSummaryAndGradesOnlyWhenCompleted() {
        InterviewSession s = session(InterviewMode.CHAT);
        s.start(T0);
        s.end(T0.plusMinutes(5), 1);
        var analyzing = InterviewMapper.toListItem(s, 1, Map.of());
        assertThat(analyzing.summary()).isNull();
        assertThat(analyzing.criterionGrades()).isEmpty();

        s.complete("총평", "다음에 해볼 것");
        Map<Criterion, Grade> grades = new EnumMap<>(Criterion.class);
        for (Criterion criterion : Criterion.values()) {
            grades.put(criterion, Grade.GOOD);
        }
        var completed = InterviewMapper.toListItem(s, 1, grades);
        assertThat(completed.summary()).isEqualTo("총평");
        assertThat(completed.answeredCount()).isEqualTo(1);
        assertThat(completed.criterionGrades())
                .extracting(CriterionGrade::criterion)
                .containsExactly(Criterion.values());
    }

    @Test
    void growthReviewHasDeltaOnlyWithComparedDay() {
        assertThat(GrowthMapper.toCriterionReview(Criterion.LOGIC, 70, null, "근거").delta())
                .isNull();
        var review = GrowthMapper.toCriterionReview(Criterion.LOGIC, 70, 62, "근거");
        assertThat(review.delta()).isEqualTo(8);
        assertThat(review.grade()).isEqualTo(Grade.of(70));

        InterviewSession s = session(InterviewMode.CHAT);
        var first = GrowthMapper.toRecentReviewItem(LocalDate.of(2026, 10, 3), s, null);
        assertThat(first.companyName()).isEqualTo("○○전자");
        assertThat(first.criterion()).isNull();
        assertThat(first.delta()).isNull();
    }

    @Test
    void practiceLogsAreSortedByDate() {
        var later = withId(new PracticeLog(user, LocalDate.of(2026, 10, 15)), 2);
        var earlier = withId(new PracticeLog(user, LocalDate.of(2026, 10, 3)), 1);
        assertThat(HomeMapper.toPracticeLogs(List.of(later, earlier)).content())
                .extracting(i -> i.practiceDate().getDayOfMonth())
                .containsExactly(3, 15);
    }

    @Test
    void grantCarriesAdminNameAndComputedTargetCount() {
        Admin admin = withId(new Admin("admin", "hash", "운영자"), 1);
        StreakFreezeGrant grant =
                withId(
                        new StreakFreezeGrant(
                                admin,
                                GrantTarget.USERS,
                                1,
                                LocalDate.of(2026, 10, 31),
                                LocalDate.of(2026, 10, 30),
                                "10월 30일 점검 보상"),
                        7);

        var response = AdminMapper.toGrant(grant, 2);

        assertThat(response.id()).isEqualTo(7);
        assertThat(response.targetCount()).isEqualTo(2);
        assertThat(response.adminName()).isEqualTo("운영자");
        assertThat(response.status()).isEqualTo(GrantStatus.SCHEDULED);
        assertThat(response.fillableDate()).isEqualTo(LocalDate.of(2026, 10, 30));
        assertThat(response.createdAt()).isEqualTo(T0);
        assertThat(response.grantedAt()).isNull();
    }

    @Test
    void noticeItemTakesReadFlagFromService() {
        Notice notice = withId(new Notice(null, "10월 점검 안내", "본문", T0, null), 3);

        assertThat(AdminMapper.toNoticeItem(notice, true).read()).isTrue();
        assertThat(AdminMapper.toNoticeItem(notice, false))
                .extracting("id", "title", "startsAt", "read")
                .containsExactly(3L, "10월 점검 안내", T0, false);
    }
}
