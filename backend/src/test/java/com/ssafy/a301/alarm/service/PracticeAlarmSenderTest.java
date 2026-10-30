package com.ssafy.a301.alarm.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.alarm.domain.PracticeAlarm;
import com.ssafy.a301.alarm.kakao.KakaoApiException;
import com.ssafy.a301.alarm.kakao.KakaoApiException.Kind;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient.KakaoToken;
import com.ssafy.a301.alarm.repository.PracticeAlarmRepository;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.practice.repository.PracticeLogRepository;
import com.ssafy.a301.practice.service.PracticeService;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class PracticeAlarmSenderTest {
    // 22:30:00.250(한국 시간)에 돈 작업
    private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-10-20T22:30:00.250+09:00");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 20);
    private static final LocalTime TIME = LocalTime.of(22, 30);
    // 건너뛴 분을 늦게라도 보내는 범위의 시작
    private static final LocalTime WINDOW_START = LocalTime.of(22, 20);

    private final PracticeAlarmRepository alarms = mock(PracticeAlarmRepository.class);
    private final PracticeLogRepository practiceLogs = mock(PracticeLogRepository.class);
    private final KakaoMessageClient kakao = mock(KakaoMessageClient.class);
    private PracticeAlarmSender sender;

    @BeforeEach
    void setUp() {
        sender =
                new PracticeAlarmSender(
                        alarms,
                        new PracticeService(practiceLogs),
                        kakao,
                        new TransactionTemplate(mock(PlatformTransactionManager.class)));
        when(practiceLogs.findPracticeDatesByUserId(anyLong())).thenReturn(List.of());
    }

    @Test
    void sendsOncePerDayWithStreakMessage() {
        alarm(1L, NOW.plusHours(3));
        due(1L);
        LocalDate today = KoreaTime.today();
        when(practiceLogs.findPracticeDatesByUserId(1L))
                .thenReturn(List.of(today.minusDays(1), today.minusDays(2)));

        assertThat(sender.sendDue(NOW)).isEqualTo(1);

        verify(alarms).claimToday(1L, TODAY);
        verify(kakao).sendToMe(eq("access-1"), eq(PracticeAlarmSender.message(2)));
        assertThat(PracticeAlarmSender.message(2)).contains("3일 연속");
        verify(kakao, never()).refresh(anyString());
    }

    @Test
    void alreadyClaimedTodayIsNotSentAgain() {
        alarm(1L, NOW.plusHours(3));
        when(alarms.findDueUserIds(WINDOW_START, TIME, TODAY)).thenReturn(List.of(1L));
        when(alarms.claimToday(1L, TODAY)).thenReturn(0);

        assertThat(sender.sendDue(NOW)).isZero();
        verify(kakao, never()).sendToMe(anyString(), anyString());
    }

    @Test
    void expiredAccessTokenIsRefreshedAndSaved() {
        PracticeAlarm alarm = alarm(1L, NOW.minusMinutes(5));
        due(1L);
        when(kakao.refresh("refresh-1"))
                .thenReturn(new KakaoToken("new-access", 21_599L, "new-refresh", 5_183_999L));

        assertThat(sender.sendDue(NOW)).isEqualTo(1);

        verify(kakao).sendToMe(eq("new-access"), anyString());
        assertThat(alarm.getKakaoAccessToken()).isEqualTo("new-access");
        assertThat(alarm.getKakaoRefreshToken()).isEqualTo("new-refresh");
        assertThat(alarm.getKakaoAccessExpiresAt()).isEqualTo(NOW.plusSeconds(21_599));
    }

    @Test
    void tokenRejectedBeforeExpiryIsRefreshedOnce() {
        alarm(1L, NOW.plusHours(3));
        due(1L);
        doThrow(new KakaoApiException(Kind.TOKEN_EXPIRED, "만료"))
                .when(kakao)
                .sendToMe(eq("access-1"), anyString());
        when(kakao.refresh("refresh-1"))
                .thenReturn(new KakaoToken("new-access", 21_599L, null, null));

        assertThat(sender.sendDue(NOW)).isEqualTo(1);

        verify(kakao).sendToMe(eq("new-access"), anyString());
    }

    @Test
    void revokedConsentTurnsAlarmOff() {
        PracticeAlarm alarm = alarm(1L, NOW.plusHours(3));
        due(1L);
        doThrow(new KakaoApiException(Kind.REJECTED, "동의 철회"))
                .when(kakao)
                .sendToMe(anyString(), anyString());

        assertThat(sender.sendDue(NOW)).isZero();

        assertThat(alarm.isEnabled()).isFalse();
    }

    @Test
    void rejectedRefreshTokenTurnsAlarmOff() {
        PracticeAlarm alarm = alarm(1L, NOW.minusMinutes(5));
        due(1L);
        when(kakao.refresh("refresh-1")).thenThrow(new KakaoApiException(Kind.REJECTED, "만료"));

        assertThat(sender.sendDue(NOW)).isZero();

        assertThat(alarm.isEnabled()).isFalse();
        verify(kakao, never()).sendToMe(anyString(), anyString());
    }

    @Test
    void oneFailureDoesNotStopOthersAndKeepsAlarm() {
        PracticeAlarm failing = alarm(1L, NOW.plusHours(3));
        alarm(2L, NOW.plusHours(3));
        due(1L, 2L);
        doThrow(new KakaoApiException(Kind.UNAVAILABLE, "카카오 오류"))
                .when(kakao)
                .sendToMe(eq("access-1"), anyString());
        doNothing().when(kakao).sendToMe(eq("access-2"), anyString());

        assertThat(sender.sendDue(NOW)).isEqualTo(1);

        assertThat(failing.isEnabled()).isTrue();
        verify(kakao, times(1)).sendToMe(eq("access-2"), anyString());
    }

    @Test
    void expiringRefreshTokensAreRenewed() {
        PracticeAlarm alarm = alarm(1L, NOW.plusHours(3));
        when(alarms.findRefreshDueUserIds(NOW.plus(PracticeAlarmSender.REFRESH_TOKEN_RENEW_BEFORE)))
                .thenReturn(List.of(1L));
        when(kakao.refresh("refresh-1"))
                .thenReturn(new KakaoToken("new-access", 21_599L, "new-refresh", 5_183_999L));

        assertThat(sender.renewExpiringTokens(NOW)).isEqualTo(1);

        assertThat(alarm.getKakaoRefreshToken()).isEqualTo("new-refresh");
        assertThat(alarm.getKakaoRefreshExpiresAt()).isEqualTo(NOW.plusSeconds(5_183_999));
    }

    @Test
    void windowDoesNotGoBackPastMidnight() {
        sender.sendDue(OffsetDateTime.parse("2026-10-21T00:05:30+09:00"));

        verify(alarms).findDueUserIds(LocalTime.MIDNIGHT, LocalTime.of(0, 5), TODAY.plusDays(1));
    }

    @Test
    void messageWithoutStreakInvitesToPractice() {
        assertThat(PracticeAlarmSender.message(0)).doesNotContain("연속").contains("연습");
    }

    private void due(Long... userIds) {
        when(alarms.findDueUserIds(WINDOW_START, TIME, TODAY)).thenReturn(List.of(userIds));
        for (Long userId : userIds) {
            when(alarms.claimToday(userId, TODAY)).thenReturn(1);
        }
    }

    // 읽기 · 잠금 조회 모두 같은 객체를 돌려줘 저장 결과를 확인한다
    private PracticeAlarm alarm(long userId, OffsetDateTime accessExpiresAt) {
        PracticeAlarm alarm = new PracticeAlarm(userId);
        alarm.changeTime(TIME);
        alarm.enable(
                "access-" + userId,
                accessExpiresAt,
                "refresh-" + userId,
                accessExpiresAt.plusDays(60));
        when(alarms.findById(userId)).thenReturn(Optional.of(alarm));
        when(alarms.findForUpdate(userId)).thenReturn(Optional.of(alarm));
        return alarm;
    }
}
