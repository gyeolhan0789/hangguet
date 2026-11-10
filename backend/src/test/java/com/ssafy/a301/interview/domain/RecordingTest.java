package com.ssafy.a301.interview.domain;

import static com.ssafy.a301.TestEntities.withId;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.User;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 합친 녹화의 다시 합치기(API 명세 6.5)와 합치기 실패 결과 처리 */
class RecordingTest {
    private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-11-10T10:00:00+09:00");
    private static final UUID FIRST_JOB = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Test
    void retryMergeWaitsForNewJobFromRequestTime() {
        Recording recording = failed();
        UUID next = UUID.randomUUID();

        recording.retryMerge(next, NOW);

        assertThat(recording.getStatus()).isEqualTo(RecordingStatus.MERGING);
        assertThat(recording.getMergeRetryCount()).isEqualTo(1);
        assertThat(recording.getMergeRequestedAt()).isEqualTo(NOW);
        assertThat(recording.getMergeJobId()).isEqualTo(next);
    }

    @Test
    void retryMergeIsLimitedToThreeTimes() {
        Recording recording = failed();
        for (int i = 0; i < Recording.MAX_MERGE_RETRIES; i++) {
            UUID job = UUID.randomUUID();
            recording.retryMerge(job, NOW.plusMinutes(i));
            recording.markMergeFailed(job.toString());
        }

        assertThatThrownBy(() -> recording.retryMerge(UUID.randomUUID(), NOW.plusHours(1)))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).errorCode())
                .isEqualTo(ErrorCode.RETRY_LIMIT_EXCEEDED);
        assertThat(recording.getStatus()).isEqualTo(RecordingStatus.FAILED);
        assertThat(recording.getMergeRetryCount()).isEqualTo(Recording.MAX_MERGE_RETRIES);
    }

    // 다시 합친 뒤 이전 작업의 실패가 늦게 오면 새 시도를 실패로 덮지 않는다
    @Test
    void lateFailureOfPreviousJobIsIgnored() {
        Recording recording = failed();
        UUID next = UUID.randomUUID();
        recording.retryMerge(next, NOW);

        assertThat(recording.markMergeFailed(FIRST_JOB.toString())).isFalse();
        assertThat(recording.getStatus()).isEqualTo(RecordingStatus.MERGING);
        assertThat(recording.markMergeFailed(next.toString())).isTrue();
        assertThat(recording.getStatus()).isEqualTo(RecordingStatus.FAILED);
    }

    // 기다리는 작업을 모르는 행(V29 이전)이나 jobId가 없는 결과는 받는다. 이미 READY이면 버린다
    @Test
    void failureWithoutKnownJobIsAcceptedUnlessReady() {
        Recording unknownJob = Recording.mergingSessionVideo(session(), null);
        assertThat(unknownJob.markMergeFailed(FIRST_JOB.toString())).isTrue();

        Recording withoutJobId = Recording.mergingSessionVideo(session(), FIRST_JOB);
        assertThat(withoutJobId.markMergeFailed(null)).isTrue();

        Recording ready = Recording.mergingSessionVideo(session(), FIRST_JOB);
        ready.markMerged(NOW);
        assertThat(ready.markMergeFailed(FIRST_JOB.toString())).isFalse();
        assertThat(ready.getStatus()).isEqualTo(RecordingStatus.READY);
    }

    // 합친 녹화 행이 없는 면접(V10 이전에 끝남)을 다시 합치면 첫 번째 다시 합치기로 센다
    @Test
    void retryingWithoutRowCountsAsFirstRetry() {
        UUID job = UUID.randomUUID();
        Recording recording = Recording.retryingSessionVideo(session(), job, NOW);

        assertThat(recording.getStatus()).isEqualTo(RecordingStatus.MERGING);
        assertThat(recording.getMergeRetryCount()).isEqualTo(1);
        assertThat(recording.getMergeRequestedAt()).isEqualTo(NOW);
        assertThat(recording.getMergeJobId()).isEqualTo(job);
    }

    private static Recording failed() {
        Recording recording = Recording.mergingSessionVideo(session(), FIRST_JOB);
        recording.markMergeFailed(FIRST_JOB.toString());
        return recording;
    }

    private static InterviewSession session() {
        User user = new User("recording@example.com", "hash", "녹화");
        return withId(
                new InterviewSession(
                        user,
                        new Application(user, "○○전자", "백엔드 개발자"),
                        Persona.DEVIL,
                        InterviewMode.VIDEO),
                55);
    }
}
