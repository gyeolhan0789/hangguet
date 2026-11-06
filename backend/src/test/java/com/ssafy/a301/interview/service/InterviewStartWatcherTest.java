package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.JobCategory;
import com.ssafy.a301.interview.InMemorySessionRuntimeStore;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.AiJobQueue;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.room.InterviewRoom.Presence;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

// 기준: AI 명세 6.5(면접관 미입장 · 첫 질문 기한 초과), BE 설계 5.1 상태 전이(시작 15초 뒤 면접관 없음 · 지원자 입장 30초 뒤 질문 행 없음),
// API 명세 5장 면접 상태(START_FAILED). 기한은 application.yml 기본값(15초 · 30초)이다
/** 실제 PostgreSQL로 첫 질문을 기다리는 개인 면접만 골라 기한이 지나면 START_FAILED로 바꾸는지 확인한다. 면접방은 가짜이고 시각은 직접 넘긴다. */
@SpringBootTest
@Transactional
@Import(InMemorySessionRuntimeStore.Config.class)
class InterviewStartWatcherTest {
    private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-05T15:00:00+09:00");

    @Autowired private InterviewStartWatcher watcher;
    @Autowired private EntityManager em;
    @MockitoBean private InterviewRoom rooms;
    // 쓰지 않지만 AiResultServiceTest와 같은 테스트 설정으로 맞춰 Spring 컨텍스트(DB 연결 풀)를 함께 쓴다
    @MockitoBean private AiJobQueue queue;

    @Test
    void interviewerMissing15SecondsAfterStartFailsStartAndClosesRoom() {
        InterviewSession session = startedAt(NOW.minusSeconds(15));
        when(rooms.presence(session.getId())).thenReturn(new Presence(false, null));

        watcher.check(NOW);

        assertThat(session.getStatus()).isEqualTo(SessionStatus.START_FAILED);
        verify(rooms).close(session.getId());
    }

    @Test
    void sessionStartedLessThan15SecondsAgoIsNotChecked() {
        InterviewSession session = startedAt(NOW.minusSeconds(14));

        watcher.check(NOW);

        assertThat(session.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
        verify(rooms, never()).presence(anyLong());
    }

    @Test
    void noFirstQuestion30SecondsAfterCandidateJoinedFailsStart() {
        InterviewSession session = startedAt(NOW.minusSeconds(40));
        when(rooms.presence(session.getId())).thenReturn(new Presence(true, NOW.minusSeconds(30)));

        watcher.check(NOW);

        assertThat(session.getStatus()).isEqualTo(SessionStatus.START_FAILED);
        verify(rooms).close(session.getId());
    }

    @Test
    void interviewerPresentKeepsWaitingUntilFirstQuestionDeadline() {
        // 지원자가 입장한 지 29초
        InterviewSession joined = startedAt(NOW.minusSeconds(40));
        when(rooms.presence(joined.getId())).thenReturn(new Presence(true, NOW.minusSeconds(29)));
        // 지원자가 아직 입장하지 않았으면 첫 질문 기한을 세지 않는다
        InterviewSession notJoined = startedAt(NOW.minusMinutes(5));
        when(rooms.presence(notJoined.getId())).thenReturn(new Presence(true, null));

        watcher.check(NOW);

        assertThat(joined.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
        assertThat(notJoined.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
        verify(rooms, never()).close(anyLong());
    }

    @Test
    void sessionWithQuestionOrGroupSessionIsNotChecked() {
        InterviewSession asked = startedAt(NOW.minusMinutes(1));
        em.persist(new InterviewQuestion(asked, 1, "질문1", NOW.minusSeconds(50)));
        InterviewSession grouped = groupSessionStartedAt(NOW.minusMinutes(1));
        em.flush();

        watcher.check(NOW);

        assertThat(asked.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
        assertThat(grouped.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
        verify(rooms, never()).presence(anyLong());
    }

    @Test
    void roomLookupFailureLeavesSessionForNextCheck() {
        InterviewSession session = startedAt(NOW.minusSeconds(20));
        when(rooms.presence(session.getId())).thenThrow(new IllegalStateException("LiveKit 응답 없음"));

        watcher.check(NOW);

        assertThat(session.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
        verify(rooms, never()).close(anyLong());
    }

    @Test
    void restartOrFirstQuestionDuringLookupIsNotFailed() {
        // 조회하는 사이 시작 실패 뒤 다시 시작했다(새 시작 시각)
        InterviewSession restarted = startedAt(NOW.minusSeconds(20));
        when(rooms.presence(restarted.getId()))
                .thenAnswer(
                        invocation -> {
                            restarted.failStart();
                            restarted.start(NOW.minusSeconds(1));
                            return new Presence(false, null);
                        });
        // 조회하는 사이 첫 질문이 왔다
        InterviewSession asked = startedAt(NOW.minusSeconds(21));
        when(rooms.presence(asked.getId()))
                .thenAnswer(
                        invocation -> {
                            em.persist(new InterviewQuestion(asked, 1, "질문1", NOW));
                            em.flush();
                            return new Presence(false, null);
                        });

        watcher.check(NOW);

        assertThat(restarted.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
        assertThat(asked.getStatus()).isEqualTo(SessionStatus.IN_PROGRESS);
        verify(rooms, never()).close(anyLong());
    }

    private InterviewSession startedAt(OffsetDateTime startedAt) {
        User user = user();
        InterviewSession session =
                new InterviewSession(user, application(user), Persona.DEVIL, InterviewMode.VIDEO);
        return start(session, startedAt);
    }

    private InterviewSession groupSessionStartedAt(OffsetDateTime startedAt) {
        User host = user();
        InterviewGroup group =
                new InterviewGroup(
                        host,
                        InterviewMode.VIDEO,
                        Persona.DEVIL,
                        JobCategory.DEVELOPMENT,
                        2,
                        UUID.randomUUID().toString().substring(0, 6));
        em.persist(group);
        InterviewSession session =
                InterviewSession.ofGroup(
                        host,
                        application(host),
                        null,
                        Persona.DEVIL,
                        InterviewMode.VIDEO,
                        group.getId());
        return start(session, startedAt);
    }

    private InterviewSession start(InterviewSession session, OffsetDateTime startedAt) {
        session.start(startedAt);
        em.persist(session);
        em.flush();
        return session;
    }

    private User user() {
        User user = new User("start-watch-" + UUID.randomUUID() + "@example.com", "hash", "감시");
        em.persist(user);
        return user;
    }

    private Application application(User user) {
        Application application = new Application(user, "○○전자", "백엔드 개발자");
        em.persist(application);
        return application;
    }
}
