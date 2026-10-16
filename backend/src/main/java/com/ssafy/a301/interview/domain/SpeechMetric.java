package com.ssafy.a301.interview.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.MapsId;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/**
 * 음성 지표. 화상 면접만, 면접당 하나(PK = session_id). 말하기 지표는 답변 음성으로, gazeRatio는 녹화 영상(6.2)으로 구한다. 구하지 못한 값은
 * null.
 */
@Entity
@Table(name = "speech_metrics")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class SpeechMetric {

    @Id
    @Column(name = "session_id")
    private Long sessionId;

    @MapsId
    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "session_id")
    private InterviewSession session;

    @Column(name = "filler_per_min", precision = 5, scale = 2)
    private BigDecimal fillerPerMin;

    @Column(name = "long_pause_count")
    private Integer longPauseCount;

    @Column(name = "speed_deviation_pct", precision = 5, scale = 2)
    private BigDecimal speedDeviationPct;

    @Column(name = "trailing_off_ratio", precision = 5, scale = 2)
    private BigDecimal trailingOffRatio;

    @Column(name = "pitch_range_st", precision = 5, scale = 2)
    private BigDecimal pitchRangeSt;

    @Column(name = "gaze_ratio", precision = 5, scale = 2)
    private BigDecimal gazeRatio;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public SpeechMetric(
            InterviewSession session,
            BigDecimal fillerPerMin,
            Integer longPauseCount,
            BigDecimal speedDeviationPct,
            BigDecimal trailingOffRatio,
            BigDecimal pitchRangeSt) {
        this.session = session;
        this.fillerPerMin = fillerPerMin;
        this.longPauseCount = longPauseCount;
        this.speedDeviationPct = speedDeviationPct;
        this.trailingOffRatio = trailingOffRatio;
        this.pitchRangeSt = pitchRangeSt;
    }

    // 녹화 영상 분석이 끝나면 채운다
    public void recordGazeRatio(BigDecimal gazeRatio) {
        this.gazeRatio = gazeRatio;
    }
}
