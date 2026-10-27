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
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** 엔티티 → 응답 DTO 변환이 명세의 값 규칙(상태별 null, 정렬, 3단계)을 따르는지 확인한다. */
class MapperTest {

    private final User user = withId(new User("a@ssafy.com", "hash", "면접왕"), 1);
    private final Application application =
            withId(new Application(user, "○○전자", "백엔드 개발자", "저는…"), 10);

    private InterviewSession session(InterviewMode mode) {
        return withId(new InterviewSession(user, application, Persona.DEVIL, mode), 55);
    }

    @Test
    void userResponseHasStreakAndImageUrl() {
        var me = UserMapper.toMe(user, "https://img", 7);
        assertThat(me.id()).isEqualTo(1);
        assertThat(me.currentStreak()).isEqualTo(7);
        assertThat(me.profileImageUrl()).isEqualTo("https://img");
        assertThat(me.createdAt()).isEqualTo(T0);
    }

    @Test
    void applicationResponseHasInUse() {
        assertThat(ApplicationMapper.toResponse(application, true).inUse()).isTrue();
        assertThat(ApplicationMapper.toListItem(application, false).companyName())
                .isEqualTo("○○전자");
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
                ResultMapper.toReplay(s, items, ResultDtos.VideoStatus.READY, "https://video");
        assertThat(replay.items()).extracting(ResultDtos.ReplayItem::seq).containsExactly(1, 2);
        assertThat(replay.items().get(1).answer()).isNull();
        // 채팅은 녹화가 없다
        assertThat(replay.videoStatus()).isNull();
        assertThat(replay.videoUrl()).isNull();
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
                ResultMapper.toReplay(s, List.of(), ResultDtos.VideoStatus.READY, "https://video");
        assertThat(replay.videoStatus()).isEqualTo(ResultDtos.VideoStatus.READY);
        assertThat(replay.videoUrl()).isEqualTo("https://video");
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
