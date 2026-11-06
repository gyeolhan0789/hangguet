package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.JobCategory;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.user.domain.User;
import jakarta.persistence.EntityManager;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 실제 PostgreSQL로 화상 면접 동시 진행 상한(BE 설계 5.2)을 확인한다. DB에 다른 면접이 있을 수 있으므로 지금 센 수에서 늘어난 만큼을 보고, 상한도 지금
 * 센 수 기준으로 정한다.
 */
@SpringBootTest
@Transactional
class InterviewCapacityTest {
    private static final Duration WINDOW = Duration.ofMinutes(90);

    @Autowired private InterviewSessionRepository sessions;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private TransactionTemplate transactions;
    @Autowired private EntityManager em;

    @Test
    void countsRunningVideoInterviewsAndGroupsOnce() {
        OffsetDateTime now = OffsetDateTime.now();
        long before = running(now);

        start(newSession(InterviewMode.VIDEO, null), now);
        // 채팅 · 시작 전 · 오래전에 시작한 면접은 세지 않는다
        start(newSession(InterviewMode.CHAT, null), now);
        newSession(InterviewMode.VIDEO, null);
        start(newSession(InterviewMode.VIDEO, null), now.minus(WINDOW).minusMinutes(1));
        // 그룹은 참가자가 여럿이어도 하나로 센다
        long groupId = newGroup();
        start(newSession(InterviewMode.VIDEO, groupId), now);
        start(newSession(InterviewMode.VIDEO, groupId), now);
        em.flush();

        assertThat(running(now) - before).isEqualTo(2);
    }

    @Test
    void reserveFailsOnlyWhenFull() {
        OffsetDateTime now = OffsetDateTime.now();
        InterviewCapacity capacity = capacity(running(now) + 1);

        capacity.reserveVideo(now);
        start(newSession(InterviewMode.VIDEO, null), now);
        em.flush();

        assertThatThrownBy(() -> capacity.reserveVideo(now))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).errorCode())
                .isEqualTo(ErrorCode.INTERVIEW_CAPACITY_FULL);
    }

    // 빈자리가 하나일 때 동시에 들어온 시작은 하나만 통과한다(잠금은 커밋까지 유지된다)
    @Test
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    void concurrentStartsTakeOneFreeSlotOnce() throws Exception {
        int requests = 4;
        List<Long> userIds = new ArrayList<>();
        List<Long> sessionIds = new ArrayList<>();
        ExecutorService pool = Executors.newFixedThreadPool(requests);
        try {
            for (int i = 0; i < requests; i++) {
                InterviewSession session =
                        transactions.execute(status -> newSession(InterviewMode.VIDEO, null));
                userIds.add(session.getUser().getId());
                sessionIds.add(session.getId());
            }
            OffsetDateTime now = OffsetDateTime.now();
            InterviewCapacity capacity = capacity(running(now) + 1);
            CountDownLatch ready = new CountDownLatch(1);
            List<Future<Boolean>> results = new ArrayList<>();
            for (long sessionId : sessionIds) {
                results.add(
                        pool.submit(
                                () -> {
                                    ready.await();
                                    return startWithin(capacity, sessionId, now);
                                }));
            }
            ready.countDown();
            int started = 0;
            for (Future<Boolean> result : results) {
                started += result.get(30, TimeUnit.SECONDS) ? 1 : 0;
            }

            assertThat(started).isEqualTo(1);
        } finally {
            pool.shutdownNow();
            for (long id : sessionIds) {
                jdbc.update("DELETE FROM interview_sessions WHERE id = ?", id);
            }
            for (long id : userIds) {
                jdbc.update("DELETE FROM applications WHERE user_id = ?", id);
                jdbc.update("DELETE FROM users WHERE id = ?", id);
            }
        }
    }

    // 5.4처럼 한 트랜잭션에서 상한을 확인하고 면접을 시작한다. 상한에 걸리면 false
    private boolean startWithin(InterviewCapacity capacity, long sessionId, OffsetDateTime now) {
        try {
            transactions.executeWithoutResult(
                    status -> {
                        capacity.reserveVideo(now);
                        jdbc.update(
                                "UPDATE interview_sessions SET status = 'IN_PROGRESS', started_at"
                                        + " = ? WHERE id = ?",
                                now,
                                sessionId);
                        // 다른 요청이 잠금을 기다리는 동안 커밋하지 않고 잠시 머문다
                        sleep();
                    });
            return true;
        } catch (ApiException e) {
            assertThat(e.errorCode()).isEqualTo(ErrorCode.INTERVIEW_CAPACITY_FULL);
            return false;
        }
    }

    private static void sleep() {
        try {
            Thread.sleep(100);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private InterviewCapacity capacity(long maxVideo) {
        return new InterviewCapacity(sessions, jdbc, Math.toIntExact(maxVideo), WINDOW);
    }

    private long running(OffsetDateTime now) {
        return sessions.countRunningVideo(now.minus(WINDOW));
    }

    private InterviewSession newSession(InterviewMode mode, Long groupId) {
        User user = new User("capacity-" + UUID.randomUUID() + "@example.com", "hash", "상한");
        em.persist(user);
        Application application = new Application(user, "○○전자", "백엔드 개발자");
        em.persist(application);
        InterviewSession session =
                groupId == null
                        ? new InterviewSession(user, application, Persona.DEVIL, mode)
                        : InterviewSession.ofGroup(
                                user, application, null, Persona.DEVIL, mode, groupId);
        em.persist(session);
        return session;
    }

    private static void start(InterviewSession session, OffsetDateTime startedAt) {
        session.start(startedAt);
    }

    private long newGroup() {
        User host = new User("capacity-host-" + UUID.randomUUID() + "@example.com", "hash", "방장");
        em.persist(host);
        InterviewGroup group =
                new InterviewGroup(
                        host,
                        InterviewMode.VIDEO,
                        Persona.DEVIL,
                        JobCategory.values()[0],
                        2,
                        UUID.randomUUID().toString().substring(0, 6));
        em.persist(group);
        em.flush();
        return group.getId();
    }
}
