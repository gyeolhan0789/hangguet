package com.ssafy.a301;

import static com.ssafy.a301.TestEntities.T0;
import static com.ssafy.a301.TestEntities.withId;
import static org.assertj.core.api.Assertions.assertThat;

import com.ssafy.a301.application.ApplicationMapper;
import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.home.HomeMapper;
import com.ssafy.a301.home.domain.PracticeLog;
import com.ssafy.a301.interview.InterviewDtos.SessionResponse;
import com.ssafy.a301.interview.InterviewMapper;
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
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.domain.SessionRuntime;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.result.ResultDtos;
import com.ssafy.a301.result.ResultDtos.ReplayResponse;
import com.ssafy.a301.result.ResultDtos.ResultResponse;
import com.ssafy.a301.result.ResultMapper;
import com.ssafy.a301.result.ResultMapper.QuestionAndAnswer;
import com.ssafy.a301.user.UserMapper;
import com.ssafy.a301.user.domain.User;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
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
                        s, new SessionRuntime(PlanStatus.GENERATING, 78, null, 0), null, 0, T0);
        assertThat(ready.planProgress()).isEqualTo(78);
        assertThat(ready.currentQuestion()).isNull();
        assertThat(ready.elapsedSeconds()).isZero();

        s.start(T0);
        SessionResponse inProgress =
                InterviewMapper.toSessionResponse(
                        s,
                        new SessionRuntime(PlanStatus.READY, 50, AnalysisStep.SCORING, 0),
                        question,
                        0,
                        T0.plusSeconds(10));
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
                        T0.plusSeconds(90));
        assertThat(analyzing.analysisStep()).isEqualTo(AnalysisStep.SCORING);
        assertThat(analyzing.currentQuestion()).isNull();
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
        s.complete("총평");
        List<QuestionAndAnswer> items =
                List.of(new QuestionAndAnswer(q2, null), new QuestionAndAnswer(q1, a1));

        ResultResponse result =
                ResultMapper.toResult(
                        s, List.of(new SessionScore(s, Criterion.LOGIC, 58, "근거부터")), items, null);
        assertThat(result.sessionScores().getFirst().grade()).isEqualTo(Grade.WEAK);
        assertThat(result.answers()).hasSize(1);
        assertThat(result.answers().getFirst().grade()).isEqualTo(Grade.GOOD);
        assertThat(result.speechMetrics()).isNull();

        ReplayResponse replay = ResultMapper.toReplay(s, items, "https://video");
        assertThat(replay.items()).extracting(ResultDtos.ReplayItem::seq).containsExactly(1, 2);
        assertThat(replay.items().get(1).answer()).isNull();
        assertThat(replay.videoUrl()).isNull();
    }

    @Test
    void videoResultHasSpeechMetricsAndVideoUrl() {
        InterviewSession s = session(InterviewMode.VIDEO);
        s.start(T0);
        s.end(T0.plusMinutes(5), 1);
        s.complete("총평");
        SpeechMetric metric = new SpeechMetric(s, new BigDecimal("2.10"), 3, null, null, null);

        ResultResponse result = ResultMapper.toResult(s, List.of(), List.of(), metric);
        assertThat(result.speechMetrics().longPauseCount()).isEqualTo(3);
        assertThat(result.speechMetrics().gazeRatio()).isNull();
        assertThat(ResultMapper.toReplay(s, List.of(), "https://video").videoUrl())
                .isEqualTo("https://video");
    }

    @Test
    void recordingResponseUsesApiType() {
        Recording video = withId(Recording.sessionVideo(session(InterviewMode.VIDEO), "k"), 77);
        assertThat(ResultMapper.toRecordingResponse(video).recordingType())
                .isEqualTo(ResultDtos.RecordingType.SESSION_VIDEO);
    }

    @Test
    void practiceLogsAreSortedByDate() {
        var later = withId(new PracticeLog(user, LocalDate.of(2026, 10, 15)), 2);
        var earlier = withId(new PracticeLog(user, LocalDate.of(2026, 10, 3)), 1);
        assertThat(HomeMapper.toPracticeLogs(List.of(later, earlier)).content())
                .extracting(i -> i.practiceDate().getDayOfMonth())
                .containsExactly(3, 15);
    }
}
