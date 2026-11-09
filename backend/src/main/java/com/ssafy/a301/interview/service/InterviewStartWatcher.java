package com.ssafy.a301.interview.service;

import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionStatus;
import com.ssafy.a301.interview.repository.InterviewQuestionRepository;
import com.ssafy.a301.interview.repository.InterviewSessionRepository;
import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.room.InterviewRoom.Presence;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Limit;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 시작한 개인 면접에 면접관이 들어와 첫 질문을 시작했는지 본다(AI 명세 6.5 · BE 설계 5.1 상태 전이). 에이전트 서버가 모두 차 있거나 응답하지 않으면
 * LiveKit은 배정을 다시 시도하지 않고 거절 메시지도 오지 않아, 면접이 IN_PROGRESS로 남고 지원자는 계속 기다린다. 질문 행이 없는 동안 면접방 참가자를
 * 조회해, 시작 뒤 면접관이 오지 않거나 지원자가 입장한 뒤 첫 질문이 없으면 배정 거절(assignment.rejected)과 같이 면접방을 닫고 START_FAILED로
 * 바꾼다. 화면은 연결이 끊기면 5.2로 START_FAILED를 보고 다시 시작(5.4)을 안내한다. 그룹 면접은 다루지 않는다.
 */
@Component
public class InterviewStartWatcher {
    static final int BATCH_SIZE = 100;
    private static final Logger LOG = LoggerFactory.getLogger(InterviewStartWatcher.class);

    private final InterviewSessionRepository sessions;
    private final InterviewQuestionRepository questions;
    private final InterviewRoom rooms;
    private final TransactionTemplate transactions;
    private final Duration interviewerTimeout;
    private final Duration firstQuestionTimeout;

    public InterviewStartWatcher(
            InterviewSessionRepository sessions,
            InterviewQuestionRepository questions,
            InterviewRoom rooms,
            TransactionTemplate transactions,
            @Value("${interview.start-watch.interviewer-timeout:15s}") Duration interviewerTimeout,
            @Value("${interview.start-watch.first-question-timeout:30s}")
                    Duration firstQuestionTimeout) {
        this.sessions = sessions;
        this.questions = questions;
        this.rooms = rooms;
        this.transactions = transactions;
        this.interviewerTimeout = interviewerTimeout;
        this.firstQuestionTimeout = firstQuestionTimeout;
    }

    @Scheduled(
            fixedDelayString = "${interview.start-watch.interval:5s}",
            initialDelayString = "${interview.start-watch.interval:5s}")
    public void check() {
        check(KoreaTime.now());
    }

    // 면접관을 기다리는 시간이 지난 면접만 본다. 지원자 입장 기한은 그보다 길어(입장은 시작 뒤) 이 대상 안에 있다
    void check(OffsetDateTime now) {
        List<InterviewSession> waiting =
                sessions.findAwaitingFirstQuestion(
                        now.minus(interviewerTimeout), Limit.of(BATCH_SIZE));
        for (InterviewSession session : waiting) {
            // 조회하는 사이 다시 시작했는지 가리려고 조회 전에 읽어 둔다
            OffsetDateTime startedAt = session.getStartedAt();
            Presence presence;
            try {
                presence = rooms.presence(session.getId());
            } catch (RuntimeException ex) {
                // LiveKit을 부르지 못하면 다른 면접도 같으므로 다음 확인에서 다시 본다
                LOG.warn("면접방 참가자를 조회하지 못해 이번 확인을 건너뛴다: session={}", session.getId(), ex);
                return;
            }
            String reason = failureReason(presence, now);
            if (reason != null) {
                failStart(session.getId(), startedAt, reason);
            }
        }
    }

    // 실패 이유. 지원자가 아직 입장하지 않았으면 첫 질문 기한은 세지 않는다
    private String failureReason(Presence presence, OffsetDateTime now) {
        if (!presence.interviewer()) {
            return "면접관 미입장";
        }
        OffsetDateTime candidateJoinedAt = presence.candidateJoinedAt();
        if (candidateJoinedAt != null
                && !now.isBefore(candidateJoinedAt.plus(firstQuestionTimeout))) {
            return "첫 질문 기한 초과";
        }
        return null;
    }

    // 조회한 뒤 그 사이 첫 질문이 왔거나 다시 시작했으면 그대로 둔다. 방은 행을 잠근 채 닫는다(배정 거절과 같은 이유: 커밋 뒤에 닫으면 그 사이
    // 다시 시작해 연 방을 지울 수 있다)
    private void failStart(long sessionId, OffsetDateTime startedAt, String reason) {
        Boolean failed =
                transactions.execute(
                        status -> {
                            InterviewSession session =
                                    sessions.findByIdForUpdate(sessionId)
                                            .filter(s -> s.getStatus() == SessionStatus.IN_PROGRESS)
                                            .orElse(null);
                            if (session == null
                                    || !session.getStartedAt().isEqual(startedAt)
                                    || questions
                                            .findFirstBySessionIdOrderBySeqDesc(sessionId)
                                            .isPresent()) {
                                return false;
                            }
                            session.failStart();
                            rooms.close(sessionId);
                            return true;
                        });
        if (Boolean.TRUE.equals(failed)) {
            LOG.warn("면접관이 첫 질문을 시작하지 않아 시작 실패로 바꿨다: session={} reason={}", sessionId, reason);
        }
    }
}
