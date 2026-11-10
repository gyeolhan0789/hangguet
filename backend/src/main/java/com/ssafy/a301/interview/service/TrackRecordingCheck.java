package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.room.InterviewRoom;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * 개인 화상 면접의 첫 질문을 저장하면, 잠시 뒤 그 면접방의 트랙이 모두 녹화 중인지 확인한다. Egress가 녹화 요청을 받지 못하면 LiveKit 로그에만 남고 면접이
 * 끝난 뒤 합치기가 TRACK_NOT_FOUND로 실패해야 드러나므로, 면접 중에 빠진 트랙만 녹화를 다시 요청한다. 첫 질문 때는 지원자 · 면접관 트랙이 이미 올라와 있다.
 * 결과 메시지 처리 스레드가 LiveKit 호출을 기다리지 않게 주기 작업 스레드에서 확인한다.
 */
@Component
public class TrackRecordingCheck {
    private final InterviewRoom rooms;
    private final TaskScheduler scheduler;
    private final Duration delay;

    public TrackRecordingCheck(
            InterviewRoom rooms,
            TaskScheduler scheduler,
            @Value("${interview.recording-check.delay:10s}") Duration delay) {
        this.rooms = rooms;
        this.scheduler = scheduler;
        this.delay = delay;
    }

    /** 첫 질문을 저장한 트랜잭션이 커밋되면 확인을 예약한다. 롤백되면 하지 않는다 */
    @TransactionalEventListener
    public void onFirstQuestionStarted(FirstQuestionStarted event) {
        scheduler.schedule(
                () -> rooms.ensureTrackRecording(event.sessionId(), event.startedAt()),
                Instant.now().plus(delay));
    }

    /** 개인 화상 면접의 첫 질문을 저장했다. startedAt은 면접 시작 시각(녹화 위치) */
    public record FirstQuestionStarted(long sessionId, OffsetDateTime startedAt) {}
}
