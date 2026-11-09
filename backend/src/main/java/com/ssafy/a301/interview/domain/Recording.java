package com.ssafy.a301.interview.domain;

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
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 녹화 파일. 파일은 S3에 있고 여기에는 objectKey만 둔다.
 *
 * <ul>
 *   <li>SESSION_VIDEO는 면접을 끝낼 때 MERGING으로 면접당 하나 만들고, 합치기 결과 메시지로 상태를 변경한다
 *   <li>ANSWER_AUDIO는 답변별 음성이 정해지면 쓴다(API 명세 B-19)
 * </ul>
 */
@Entity
@Table(name = "recordings")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Recording {

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

    // 행을 만든 일시. 합친 녹화는 면접을 끝낸 일시다
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    /** Egress가 원본 트랙을 저장하는 위치(AI 명세 7장). 녹화를 시작할 때와 합치기 작업이 같은 값을 쓴다 */
    public static String rawPrefix(long sessionId) {
        return "recordings/raw/" + sessionId + "/";
    }

    /**
     * 그룹 면접방의 녹화 원본 위치(docs/그룹면접-설계.md 6.12). 시작 실패 뒤 다시 시작하면 이전 시도의 트랙과 섞이지 않게 시작 시각(유닉스 밀리초)마다
     * 나눈다(개인 면접 BE 설계 5.6과 같은 규칙). 그 안의 파일은 참가자마다 candidate-{sessionId}로 시작한다.
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
    public static Recording mergingSessionVideo(InterviewSession session) {
        return sessionVideo(session, RecordingStatus.MERGING);
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

    /** recording.mergeFailed. 이미 READY이면 파일이 있으므로 변경하지 않고 false */
    public boolean markMergeFailed() {
        if (status == RecordingStatus.READY) {
            return false;
        }
        this.status = RecordingStatus.FAILED;
        return true;
    }
}
