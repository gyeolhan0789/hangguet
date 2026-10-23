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
 * 녹화 파일. 파일은 S3에 있고 여기에는 objectKey만 둔다. SESSION_VIDEO는 녹화 합치기 결과(recording.merged)로 면접당 하나 만든다.
 * ANSWER_AUDIO는 답변별 음성이 정해지면 쓴다(API 명세 B-19).
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

    // 업로드를 마친(등록한) 일시
    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    /** Egress가 원본 트랙을 저장하는 위치(AI 명세 7장). 녹화를 시작할 때와 합치기 작업이 같은 값을 쓴다 */
    public static String rawPrefix(long sessionId) {
        return "recordings/raw/" + sessionId + "/";
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
        return r;
    }

    public static Recording sessionVideo(InterviewSession session, String objectKey) {
        Recording r = new Recording();
        r.session = session;
        r.recordingType = RecordingType.SESSION_VIDEO;
        r.objectKey = objectKey;
        return r;
    }
}
