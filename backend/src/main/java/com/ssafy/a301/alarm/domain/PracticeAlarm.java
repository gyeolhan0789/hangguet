package com.ssafy.a301.alarm.domain;

import com.ssafy.a301.inquiry.crypto.EncryptedTextConverter;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * 카카오톡 연습 알림(2.8 ~ 2.11). 회원마다 한 행. 켜져 있을 때만 카카오 토큰이 있고, 끄면 토큰만 지우고 알림 시각은 남긴다. 토큰은 저장할 때 암호화한다
 * (EncryptedTextConverter).
 */
@Entity
@Table(name = "practice_alarms")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PracticeAlarm {
    /** 시각을 고르지 않았을 때(한국 시간) */
    public static final LocalTime DEFAULT_TIME = LocalTime.of(21, 0);

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Column(name = "alarm_time", nullable = false)
    private LocalTime alarmTime;

    @Convert(converter = EncryptedTextConverter.class)
    @Column(name = "kakao_access_token")
    private String kakaoAccessToken;

    @Column(name = "kakao_access_expires_at")
    private OffsetDateTime kakaoAccessExpiresAt;

    @Convert(converter = EncryptedTextConverter.class)
    @Column(name = "kakao_refresh_token")
    private String kakaoRefreshToken;

    @Column(name = "kakao_refresh_expires_at")
    private OffsetDateTime kakaoRefreshExpiresAt;

    @Column(name = "last_sent_on")
    private LocalDate lastSentOn;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    public PracticeAlarm(long userId) {
        this.userId = userId;
        this.alarmTime = DEFAULT_TIME;
    }

    public boolean isEnabled() {
        return kakaoRefreshToken != null;
    }

    /** 분 단위로 저장한다(매분 그 시각에 보낸다) */
    public void changeTime(LocalTime time) {
        this.alarmTime = time.withSecond(0).withNano(0);
    }

    public void enable(
            String accessToken,
            OffsetDateTime accessExpiresAt,
            String refreshToken,
            OffsetDateTime refreshExpiresAt) {
        this.kakaoAccessToken = accessToken;
        this.kakaoAccessExpiresAt = accessExpiresAt;
        this.kakaoRefreshToken = refreshToken;
        this.kakaoRefreshExpiresAt = refreshExpiresAt;
    }

    /** 카카오는 리프레시 토큰이 1개월 미만으로 남았을 때만 새로 준다. 주지 않았으면(null) 이전 것을 그대로 둔다 */
    public void renewTokens(
            String accessToken,
            OffsetDateTime accessExpiresAt,
            String refreshToken,
            OffsetDateTime refreshExpiresAt) {
        this.kakaoAccessToken = accessToken;
        this.kakaoAccessExpiresAt = accessExpiresAt;
        if (refreshToken != null && refreshExpiresAt != null) {
            this.kakaoRefreshToken = refreshToken;
            this.kakaoRefreshExpiresAt = refreshExpiresAt;
        }
    }

    public void disable() {
        this.kakaoAccessToken = null;
        this.kakaoAccessExpiresAt = null;
        this.kakaoRefreshToken = null;
        this.kakaoRefreshExpiresAt = null;
    }
}
