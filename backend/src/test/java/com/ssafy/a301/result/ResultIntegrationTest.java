package com.ssafy.a301.result;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.InputType;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.Recording;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.storage.s3.S3FileStorage;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;

/** 6.3 면접 결과·6.4 다시보기. 로컬은 docker compose의 PostgreSQL이 필요하다. S3 주소 발급은 대역으로 바꾼다. */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ResultIntegrationTest {
    private static final OffsetDateTime START = OffsetDateTime.parse("2026-10-21T10:00:00+09:00");

    @Autowired private MockMvc mvc;
    @Autowired private EntityManager em;
    @MockitoBean private S3FileStorage storage;

    @Test
    void videoResultHasOrderedScoresAnsweredQuestionsAndSpeechMetrics() throws Exception {
        User user = user("video");
        InterviewSession session = completed(user, InterviewMode.VIDEO);
        em.persist(new SpeechMetric(session, new BigDecimal("2.10"), 3, null, null, null));
        em.flush();
        em.clear();

        mvc.perform(as(user, get("/api/v1/interview-sessions/" + session.getId() + "/result")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("VIDEO"))
                .andExpect(jsonPath("$.companyName").value("○○전자"))
                .andExpect(jsonPath("$.jobTitle").value("백엔드 개발자"))
                .andExpect(jsonPath("$.summary").value("총평"))
                .andExpect(jsonPath("$.sessionScores.length()").value(4))
                .andExpect(jsonPath("$.sessionScores[0].criterion").value("JOB_FIT"))
                .andExpect(jsonPath("$.sessionScores[0].grade").value("GOOD"))
                .andExpect(jsonPath("$.sessionScores[3].criterion").value("DELIVERY"))
                .andExpect(jsonPath("$.sessionScores[3].grade").value("WEAK"))
                // 답변하지 않은 3번 질문은 빠지고 질문 순이다
                .andExpect(jsonPath("$.answers.length()").value(2))
                .andExpect(jsonPath("$.answers[0].seq").value(1))
                .andExpect(jsonPath("$.answers[0].grade").value("NORMAL"))
                .andExpect(jsonPath("$.answers[0].improvePoint").value("근거부터"))
                .andExpect(jsonPath("$.answers[1].seq").value(2))
                .andExpect(jsonPath("$.speechMetrics.fillerPerMin").value(2.1))
                .andExpect(jsonPath("$.speechMetrics.longPauseCount").value(3))
                // 비어 있는 지표는 null
                .andExpect(jsonPath("$.speechMetrics.pitchRangeSt").isEmpty())
                .andExpect(jsonPath("$.speechMetrics.gazeRatio").isEmpty());
    }

    @Test
    void videoResultWithoutSpeechMetricsRowHasNullMetrics() throws Exception {
        User user = user("no-metrics");
        InterviewSession session = completed(user, InterviewMode.VIDEO);
        em.flush();
        em.clear();

        mvc.perform(as(user, get("/api/v1/interview-sessions/" + session.getId() + "/result")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.speechMetrics").isEmpty());
    }

    @Test
    void chatResultHasNullSpeechMetrics() throws Exception {
        User user = user("chat");
        InterviewSession session = completed(user, InterviewMode.CHAT);
        em.flush();
        em.clear();

        mvc.perform(as(user, get("/api/v1/interview-sessions/" + session.getId() + "/result")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("CHAT"))
                .andExpect(jsonPath("$.speechMetrics").isEmpty());
    }

    @Test
    void chatReplayIsConversationWithoutVideo() throws Exception {
        User user = user("chat-replay");
        InterviewSession session = completed(user, InterviewMode.CHAT);
        em.flush();
        em.clear();

        mvc.perform(as(user, get("/api/v1/interview-sessions/" + session.getId() + "/replay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("CHAT"))
                .andExpect(jsonPath("$.videoStatus").isEmpty())
                .andExpect(jsonPath("$.videoUrl").isEmpty())
                .andExpect(jsonPath("$.items.length()").value(3));
    }

    @Test
    void videoReplayHasMergedVideoUrlAndAllQuestions() throws Exception {
        User user = user("replay");
        InterviewSession session = completed(user, InterviewMode.VIDEO);
        String key = Recording.sessionVideoKey(session.getId());
        em.persist(Recording.mergedSessionVideo(session));
        when(storage.presignDownload(key)).thenReturn("https://s3.test/video.mp4");
        em.flush();
        em.clear();

        mvc.perform(as(user, get("/api/v1/interview-sessions/" + session.getId() + "/replay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.videoStatus").value("READY"))
                .andExpect(jsonPath("$.videoUrl").value("https://s3.test/video.mp4"))
                .andExpect(jsonPath("$.startedAt").value("2026-10-21T10:00:00+09:00"))
                .andExpect(jsonPath("$.items.length()").value(3))
                .andExpect(jsonPath("$.items[0].seq").value(1))
                .andExpect(
                        jsonPath("$.items[0].questionCreatedAt").value("2026-10-21T10:01:00+09:00"))
                .andExpect(jsonPath("$.items[0].answer").value("1번 답변"))
                .andExpect(jsonPath("$.items[0].grade").value("NORMAL"))
                // 답변하지 않은 질문도 마커로 들어간다
                .andExpect(jsonPath("$.items[2].seq").value(3))
                .andExpect(jsonPath("$.items[2].answer").isEmpty())
                .andExpect(jsonPath("$.items[2].grade").isEmpty());
        verify(storage).presignDownload(key);
    }

    @Test
    void videoReplayWhileMergingHasNoVideoUrl() throws Exception {
        User user = user("before-merge");
        InterviewSession session = completed(user, InterviewMode.VIDEO, OffsetDateTime.now());
        em.persist(Recording.mergingSessionVideo(session));
        em.flush();
        em.clear();

        mvc.perform(as(user, get("/api/v1/interview-sessions/" + session.getId() + "/replay")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.videoStatus").value("MERGING"))
                .andExpect(jsonPath("$.videoUrl").isEmpty())
                .andExpect(jsonPath("$.items.length()").value(3));
        verify(storage, never()).presignDownload(anyString());
    }

    @Test
    void videoReplayAfterMergeFailureOrWithoutRecordingIsFailed() throws Exception {
        User user = user("merge-failed");
        InterviewSession failed = completed(user, InterviewMode.VIDEO, OffsetDateTime.now());
        Recording recording = Recording.mergingSessionVideo(failed);
        recording.markMergeFailed();
        em.persist(recording);
        // 녹화 상태를 추가하기 전에 끝나 행이 없고, 종료 후 15분이 지난 면접
        InterviewSession withoutRecording = completed(user, InterviewMode.VIDEO);
        em.flush();
        em.clear();

        for (InterviewSession session : new InterviewSession[] {failed, withoutRecording}) {
            mvc.perform(as(user, get("/api/v1/interview-sessions/" + session.getId() + "/replay")))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.videoStatus").value("FAILED"))
                    .andExpect(jsonPath("$.videoUrl").isEmpty())
                    .andExpect(jsonPath("$.items.length()").value(3));
        }
        verify(storage, never()).presignDownload(anyString());
    }

    @Test
    void otherUsersSessionIsNotFoundAndUnfinishedSessionsHaveNoResult() throws Exception {
        User owner = user("owner");
        InterviewSession completed = completed(owner, InterviewMode.VIDEO);
        InterviewSession analyzing = ended(owner, 1);
        InterviewSession failed = ended(owner, 1);
        failed.failAnalysis();
        InterviewSession aborted = ended(owner, 0);
        InterviewSession inProgress = session(owner, InterviewMode.VIDEO);
        User other = user("other");
        em.flush();
        em.clear();

        for (String path : new String[] {"/result", "/replay"}) {
            mvc.perform(as(other, get("/api/v1/interview-sessions/" + completed.getId() + path)))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
            mvc.perform(as(owner, get("/api/v1/interview-sessions/0" + path)))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("SESSION_NOT_FOUND"));
            for (InterviewSession notReady :
                    new InterviewSession[] {analyzing, failed, inProgress}) {
                mvc.perform(as(owner, get("/api/v1/interview-sessions/" + notReady.getId() + path)))
                        .andExpect(status().isConflict())
                        .andExpect(jsonPath("$.code").value("RESULT_NOT_READY"));
            }
            mvc.perform(as(owner, get("/api/v1/interview-sessions/" + aborted.getId() + path)))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("NO_RESULT"));
        }
    }

    @Test
    void completedResultWithMissingCriterionIsInternalError() throws Exception {
        User user = user("broken");
        InterviewSession session = ended(user, 1);
        session.complete("총평");
        em.persist(new SessionScore(session, Criterion.JOB_FIT, 80, "직무"));
        em.flush();
        em.clear();

        mvc.perform(as(user, get("/api/v1/interview-sessions/" + session.getId() + "/result")))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("INTERNAL_ERROR"));
    }

    /** 질문 3개 중 1·2번에 답하고 결과가 나온 면접 */
    private InterviewSession completed(User owner, InterviewMode mode) {
        return completed(owner, mode, START.plusMinutes(10));
    }

    private InterviewSession completed(User owner, InterviewMode mode, OffsetDateTime endedAt) {
        InterviewSession session = session(owner, mode);
        InputType inputType = mode == InterviewMode.VIDEO ? InputType.VOICE : InputType.TEXT;
        for (int seq = 1; seq <= 3; seq++) {
            InterviewQuestion question =
                    new InterviewQuestion(session, seq, seq + "번 질문", START.plusMinutes(seq));
            em.persist(question);
            if (seq < 3) {
                Answer answer = new Answer(question, inputType, seq + "번 답변");
                answer.evaluate(seq == 1 ? 70 : 85, "잘한 점", seq == 1 ? "근거부터" : null);
                em.persist(answer);
            }
        }
        session.end(endedAt, 2);
        session.complete("총평");
        em.persist(new SessionScore(session, Criterion.DELIVERY, 50, "전달"));
        em.persist(new SessionScore(session, Criterion.LOGIC, 70, "논리"));
        em.persist(new SessionScore(session, Criterion.COVER_LETTER, 60, "자소서"));
        em.persist(new SessionScore(session, Criterion.JOB_FIT, 80, "직무"));
        return session;
    }

    private InterviewSession ended(User owner, int answeredCount) {
        InterviewSession session = session(owner, InterviewMode.VIDEO);
        session.end(START.plusMinutes(10), answeredCount);
        return session;
    }

    private InterviewSession session(User owner, InterviewMode mode) {
        Application application = new Application(owner, "○○전자", "백엔드 개발자", "자소서");
        em.persist(application);
        InterviewSession session = new InterviewSession(owner, application, Persona.DEVIL, mode);
        em.persist(session);
        session.start(START);
        return session;
    }

    private User user(String name) {
        User created =
                new User("result-" + name + "-" + UUID.randomUUID() + "@example.com", "hash", name);
        em.persist(created);
        return created;
    }

    private static MockHttpServletRequestBuilder as(
            User user, MockHttpServletRequestBuilder request) {
        return request.with(jwt().jwt(token -> token.subject(user.getId().toString())));
    }
}
