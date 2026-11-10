package com.ssafy.a301.interview.domain;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 녹화 파일. 파일은 S3에 있고 여기에는 objectKey만 둔다.
 *
 * <ul>
 *   <li>SESSION_VIDEO는 면접을 끝낼 때 MERGING으로 면접당 하나 만들고, 합치기 결과 메시지로 상태를 변경한다
 *   <li>SESSION_VIDEO가 FAILED이면 6.5로 같은 원본을 다시 합친다. 다시 합친 횟수 · 요청 시각 · 기다리는 작업 id를 남긴다
 *   <li>ANSWER_AUDIO는 답변별 음성이 정해지면 쓴다(API 명세 B-19)
 * </ul>
 */
@Entity
@Table(name = "recordings")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Recording {
    // 한 면접에서 녹화를 다시 합칠 수 있는 횟수(API 명세 6.5, 임시 값)
    public static final int MAX_MERGE_RETRIES = 3;

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id", nullable = false)
    private InterviewSession session;

    // 답변 음성이면 그 답변, 세션 녹화 영상이면 null
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "answer_id")
    private Answer answer;

    @Enumerated(EnumType.STRING)
    @Column(name = "recording_type", nullable = false, length = 20)
    private RecordingType recordingType;

    @Column(name = "object_key", nullable = false, length = 500, unique = true)
    private String objectKey;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 10)
    private RecordingStatus status;

    // 합친 녹화의 0초에 해당하는 시각(recording.merged). 이어 붙여 합쳤거나 V19 전에 합친 녹화는 null
    @Column(name = "recording_started_at")
    private OffsetDateTime recordingStartedAt;

    // 6.5로 다시 합친 횟수
    @Column(name = "merge_retry_count", nullable = false)
    private int mergeRetryCount;

    // 마지막으로 합치기를 다시 요청한 시각. 다시보기(6.4)는 값이 있으면 이 시각부터 합치기 결과를 기다린다. 다시 합친 적이 없으면 null
    @Column(name = "merge_requested_at")
    private OffsetDateTime mergeRequestedAt;

    // 지금 기다리는 합치기 작업(jobId). 다른 작업의 실패 결과는 이전 시도의 늦은 결과라 버린다. V29 전에 넣은 작업은 null
    @Column(name = "merge_job_id")
    private UUID mergeJobId;

    // 행을 만든 일시. 합친 녹화는 면접을 끝낸 일시다
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    /**
     * Egress가 원본 트랙을 저장하는 위치(AI 명세 7장, BE 설계 5.6). 시작 실패 뒤 다시 시작하면 이전 시도의 트랙과 섞이지 않게 시작 시각(유닉스
     * 밀리초)마다 나눈다. 녹화를 시작할 때와 합치기 작업이 같은 값을 쓴다
     */
    public static String rawPrefix(long sessionId, OffsetDateTime startedAt) {
        return "recordings/raw/" + sessionId + "/" + startedAt.toInstant().toEpochMilli() + "/";
    }

    /**
     * 그룹 면접방의 녹화 원본 위치(docs/그룹면접-설계.md 6.12). 개인 면접과 같이 시작 시각(유닉스 밀리초)마다 나눈다. 그 안의 파일은 참가자마다
     * candidate-{sessionId}로 시작한다.
     */
    public static String groupRawPrefix(long groupId, OffsetDateTime startedAt) {
        return "recordings/raw/group-" + groupId + "/" + startedAt.toInstant().toEpochMilli() + "/";
    }

    /** 원본 트랙을 합친 mp4 위치(AI 명세 7장) */
    public static String sessionVideoKey(long sessionId) {
        return "recordings/" + sessionId + ".mp4";
    }

    public static Recording answerAudio(InterviewSession session, Answer answer, String objectKey) {
        Recording r = new Recording();
        r.session = session;
        r.answer = answer;
        r.recordingType = RecordingType.ANSWER_AUDIO;
        r.objectKey = objectKey;
        r.status = RecordingStatus.READY;
        return r;
    }

    /** 면접을 끝내며 합치기 작업을 넣을 때 만든다. 위치는 합치기 작업과 같은 sessionVideoKey다 */
    public static Recording mergingSessionVideo(InterviewSession session, UUID jobId) {
        Recording r = sessionVideo(session, RecordingStatus.MERGING);
        r.mergeJobId = jobId;
        return r;
    }

    /** 합친 녹화 행이 없는데 다시보기가 FAILED인 면접(V10 이전에 끝남)을 6.5로 다시 합칠 때 만든다. 첫 번째 다시 합치기로 센다 */
    public static Recording retryingSessionVideo(
            InterviewSession session, UUID jobId, OffsetDateTime now) {
        Recording r = mergingSessionVideo(session, jobId);
        r.mergeRetryCount = 1;
        r.mergeRequestedAt = now;
        return r;
    }

    /** 합친 녹화가 이미 저장소에 있는 경우. V10 이전에 끝나 MERGING 행이 없는 면접의 recording.merged에 쓴다 */
    public static Recording mergedSessionVideo(
            InterviewSession session, OffsetDateTime recordingStartedAt) {
        Recording r = sessionVideo(session, RecordingStatus.READY);
        r.recordingStartedAt = recordingStartedAt;
        return r;
    }

    private static Recording sessionVideo(InterviewSession session, RecordingStatus status) {
        Recording r = new Recording();
        r.session = session;
        r.recordingType = RecordingType.SESSION_VIDEO;
        r.objectKey = sessionVideoKey(session.getId());
        r.status = status;
        return r;
    }

    /** recording.merged. 파일이 올라왔으므로 앞서 실패로 기록했어도 READY로 변경하고, 영상 0초 시각(null 가능)을 함께 저장한다 */
    public void markMerged(OffsetDateTime recordingStartedAt) {
        this.status = RecordingStatus.READY;
        this.recordingStartedAt = recordingStartedAt;
    }

    /**
     * 6.5 녹화 다시 합치기. 같은 원본으로 다시 합치므로 MERGING으로 되돌리고 새 작업을 기다린다. 다시보기가 FAILED인지는 부르는 쪽이 확인한다(15분 판정은
     * 저장하지 않으므로 행은 MERGING일 수도 있다). 이미 MAX_MERGE_RETRIES번 다시 합쳤으면 409 RETRY_LIMIT_EXCEEDED.
     */
    public void retryMerge(UUID jobId, OffsetDateTime now) {
        if (mergeRetryCount >= MAX_MERGE_RETRIES) {
            throw new ApiException(ErrorCode.RETRY_LIMIT_EXCEEDED);
        }
        this.status = RecordingStatus.MERGING;
        this.mergeRetryCount++;
        this.mergeRequestedAt = now;
        this.mergeJobId = jobId;
    }

    /**
     * recording.mergeFailed. 이미 READY이면 파일이 있으므로 변경하지 않고 false. 다시 합치기(6.5) 전에 넣은 작업의 늦은 실패이면 새 시도를
     * 실패로 덮지 않게 false다. 결과에 jobId가 없거나 기다리는 작업을 모르면(V29 이전) 받는다.
     */
    public boolean markMergeFailed(String jobId) {
        if (status == RecordingStatus.READY
                || (mergeJobId != null && jobId != null && !mergeJobId.toString().equals(jobId))) {
            return false;
        }
        this.status = RecordingStatus.FAILED;
        return true;
    }
}
