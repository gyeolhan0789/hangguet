package com.ssafy.a301.result.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.RecordingStatus;
import com.ssafy.a301.result.dto.ResultDtos.VideoStatus;
import com.ssafy.a301.user.domain.User;
import java.time.OffsetDateTime;
import org.junit.jupiter.api.Test;

/** 6.4 녹화 상태 판정. 합치기 결과가 없으면 면접 종료 후 15분까지만 MERGING이다(API 명세 6.4) */
class ReplayVideoStatusTest {
    private static final OffsetDateTime ENDED = OffsetDateTime.parse("2026-10-27T10:10:00+09:00");
    private static final OffsetDateTime DEADLINE = ENDED.plus(ResultService.MERGE_WAIT);

    @Test
    void mergeWaitIsFifteenMinutes() {
        assertThat(DEADLINE).isEqualTo(OffsetDateTime.parse("2026-10-27T10:25:00+09:00"));
    }

    @Test
    void readyRecordingIsReadyEvenAfterMergeWait() {
        assertThat(status(RecordingStatus.READY, DEADLINE.plusHours(1)))
                .isEqualTo(VideoStatus.READY);
    }

    @Test
    void failedRecordingIsFailedBeforeMergeWait() {
        assertThat(status(RecordingStatus.FAILED, ENDED)).isEqualTo(VideoStatus.FAILED);
    }

    @Test
    void mergingIsFailedOnlyFromMergeWait() {
        assertThat(status(RecordingStatus.MERGING, DEADLINE.minusSeconds(1)))
                .isEqualTo(VideoStatus.MERGING);
        assertThat(status(RecordingStatus.MERGING, DEADLINE)).isEqualTo(VideoStatus.FAILED);
    }

    @Test
    void missingRecordingFollowsMergeWait() {
        // 녹화 상태를 추가하기 전에 끝나 행이 없는 면접
        assertThat(status(null, DEADLINE.minusSeconds(1))).isEqualTo(VideoStatus.MERGING);
        assertThat(status(null, DEADLINE)).isEqualTo(VideoStatus.FAILED);
    }

    private static VideoStatus status(RecordingStatus recording, OffsetDateTime now) {
        return ResultService.videoStatus(endedSession(), recording, now);
    }

    private static InterviewSession endedSession() {
        User user = new User("replay-status@example.com", "hash", "녹화");
        Application application = new Application(user, "○○전자", "백엔드 개발자", "저는…");
        InterviewSession session =
                new InterviewSession(user, application, Persona.DEVIL, InterviewMode.VIDEO);
        session.start(ENDED.minusMinutes(10));
        session.end(ENDED, 1);
        return session;
    }
}
