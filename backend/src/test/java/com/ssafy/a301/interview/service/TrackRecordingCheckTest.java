package com.ssafy.a301.interview.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import com.ssafy.a301.interview.room.InterviewRoom;
import com.ssafy.a301.interview.service.TrackRecordingCheck.FirstQuestionStarted;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.scheduling.TaskScheduler;

/** 첫 질문 이벤트를 받으면 정한 시간 뒤로 트랙 녹화 확인을 예약하는지 본다. 예약된 작업은 직접 실행한다. */
class TrackRecordingCheckTest {
    private static final Duration DELAY = Duration.ofSeconds(10);
    private static final OffsetDateTime STARTED_AT =
            OffsetDateTime.parse("2026-11-10T10:00:00+09:00");

    private final InterviewRoom rooms = mock(InterviewRoom.class);
    private final TaskScheduler scheduler = mock(TaskScheduler.class);
    private final TrackRecordingCheck check = new TrackRecordingCheck(rooms, scheduler, DELAY);

    @Test
    void checksRoomAfterDelay() {
        Instant before = Instant.now();
        check.onFirstQuestionStarted(new FirstQuestionStarted(55L, STARTED_AT));

        ArgumentCaptor<Runnable> task = ArgumentCaptor.forClass(Runnable.class);
        ArgumentCaptor<Instant> at = ArgumentCaptor.forClass(Instant.class);
        verify(scheduler).schedule(task.capture(), at.capture());
        assertThat(at.getValue()).isAfterOrEqualTo(before.plus(DELAY));
        verifyNoInteractions(rooms);

        task.getValue().run();
        verify(rooms).ensureTrackRecording(55L, STARTED_AT);
    }
}
