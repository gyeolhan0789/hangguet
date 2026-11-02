package com.ssafy.a301.alarm.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.alarm.kakao.KakaoApiException;
import com.ssafy.a301.alarm.kakao.KakaoApiException.Kind;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient.KakaoConsent;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient.KakaoToken;
import com.ssafy.a301.alarm.repository.PracticeAlarmRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.user.domain.SocialProvider;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.domain.UserSocialAccount;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.repository.UserSocialAccountRepository;
import java.time.LocalTime;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class PracticeAlarmServiceTest {
    private static final long USER_ID = 7L;
    private static final String REDIRECT = "https://a301/oauth/kakao/callback";

    private final PracticeAlarmRepository alarms = mock(PracticeAlarmRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final UserSocialAccountRepository socialAccounts =
            mock(UserSocialAccountRepository.class);
    private final KakaoMessageClient kakao = mock(KakaoMessageClient.class);
    private PracticeAlarmService service;

    @BeforeEach
    void setUp() {
        service =
                new PracticeAlarmService(
                        alarms,
                        users,
                        socialAccounts,
                        kakao,
                        new TransactionTemplate(mock(PlatformTransactionManager.class)));
        User user = User.social("k@kakao.com", "카카오");
        when(socialAccounts.findActiveByUserId(USER_ID))
                .thenReturn(
                        Optional.of(new UserSocialAccount(user, SocialProvider.KAKAO, "12345")));
        when(kakao.isConfigured()).thenReturn(true);
        when(kakao.isAllowedRedirectUri(REDIRECT)).thenReturn(true);
    }

    @Test
    void unusableCodeIsConsentFailureAndKakaoErrorIsUnavailable() {
        when(kakao.exchange("used", REDIRECT))
                .thenThrow(new KakaoApiException(Kind.REJECTED, "invalid_grant"));
        assertCode(() -> service.enable(USER_ID, "used", REDIRECT), ErrorCode.KAKAO_CONSENT_FAILED);

        when(kakao.exchange("code", REDIRECT))
                .thenThrow(new KakaoApiException(Kind.UNAVAILABLE, "500"));
        assertCode(() -> service.enable(USER_ID, "code", REDIRECT), ErrorCode.KAKAO_UNAVAILABLE);
    }

    @Test
    void missingKeyOrUnregisteredRedirectIsRejectedBeforeCallingKakao() {
        assertThatThrownBy(() -> service.enable(USER_ID, "code", "https://evil/callback"))
                .isInstanceOf(FieldValidationException.class);

        when(kakao.isConfigured()).thenReturn(false);
        assertCode(() -> service.enable(USER_ID, "code", REDIRECT), ErrorCode.KAKAO_UNAVAILABLE);

        verify(kakao, never()).exchange(anyString(), anyString());
    }

    @Test
    void tokenWithoutRefreshTokenIsNotSaved() {
        when(kakao.exchange("code", REDIRECT))
                .thenReturn(new KakaoToken("access", 21_599L, null, null));
        when(kakao.consent("access")).thenReturn(new KakaoConsent("12345", true));

        assertCode(() -> service.enable(USER_ID, "code", REDIRECT), ErrorCode.KAKAO_UNAVAILABLE);
        verify(alarms, never()).insertIfAbsent(anyLong(), any());
    }

    @Test
    void googleUserCannotUseAlarm() {
        User user = User.social("g@gmail.com", "구글");
        when(socialAccounts.findActiveByUserId(USER_ID))
                .thenReturn(Optional.of(new UserSocialAccount(user, SocialProvider.GOOGLE, "g-1")));

        assertThat(service.get(USER_ID).available()).isFalse();
        assertCode(
                () -> service.enable(USER_ID, "code", REDIRECT),
                ErrorCode.PRACTICE_ALARM_UNAVAILABLE);
        assertCode(
                () -> service.changeTime(USER_ID, LocalTime.of(22, 30)),
                ErrorCode.PRACTICE_ALARM_UNAVAILABLE);
    }

    @Test
    void defaultIsOffAt21() {
        var response = service.get(USER_ID);

        assertThat(response.available()).isTrue();
        assertThat(response.enabled()).isFalse();
        assertThat(response.time()).isEqualTo("21:00");
    }

    private static void assertCode(Runnable call, ErrorCode code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.errorCode()).isEqualTo(code));
    }
}
