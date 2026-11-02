package com.ssafy.a301.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.alarm.repository.PracticeAlarmRepository;
import com.ssafy.a301.auth.oauth.KakaoLoginClient;
import com.ssafy.a301.auth.oauth.SocialProfile;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.SocialProvider;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.repository.UserSocialAccountRepository;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 2.12 · 2.13에서 DB로 재현하기 어려운 경우(겹친 연결 · 카카오 장애) */
class SocialAccountServiceTest {
    private static final long USER_ID = 7L;
    private static final String REDIRECT = "https://a301/oauth/kakao/callback";

    private final KakaoLoginClient kakao = mock(KakaoLoginClient.class);
    private final UserRepository users = mock(UserRepository.class);
    private final UserSocialAccountRepository socialAccounts =
            mock(UserSocialAccountRepository.class);
    private final PracticeAlarmRepository alarms = mock(PracticeAlarmRepository.class);
    private final UserService userService = mock(UserService.class);
    private SocialAccountService service;

    @BeforeEach
    void setUp() {
        service =
                new SocialAccountService(
                        kakao,
                        users,
                        socialAccounts,
                        alarms,
                        userService,
                        new TransactionTemplate(mock(PlatformTransactionManager.class)));
        User user = new User("a@test.com", "hash", "이메일");
        ReflectionTestUtils.setField(user, "id", USER_ID);
        when(users.findByIdAndDeletedAtIsNull(USER_ID)).thenReturn(Optional.of(user));
        when(users.findActiveForUpdate(USER_ID)).thenReturn(Optional.of(user));
    }

    @Test
    void sameKakaoAccountLinkedConcurrentlyIsInUse() {
        when(kakao.fetchProfile("code", REDIRECT))
                .thenReturn(new SocialProfile(SocialProvider.KAKAO, "12345", null, null));
        // 확인한 뒤 다른 가입 · 연결이 먼저 커밋돼 유일 인덱스에 걸렸다
        when(socialAccounts.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("uk_user_social_accounts_active"));

        assertCode(
                () -> service.link(USER_ID, "kakao", "code", REDIRECT),
                ErrorCode.SOCIAL_ACCOUNT_IN_USE);
    }

    @Test
    void secondLinkOfSameUserIsAlreadyLinked() {
        when(kakao.fetchProfile("code", REDIRECT))
                .thenReturn(new SocialProfile(SocialProvider.KAKAO, "12345", null, null));
        when(socialAccounts.saveAndFlush(any()))
                .thenThrow(
                        new DataIntegrityViolationException(
                                "duplicate key",
                                new RuntimeException(
                                        "violates unique constraint"
                                                + " \"uk_user_social_accounts_user_active\"")));

        assertCode(
                () -> service.link(USER_ID, "kakao", "code", REDIRECT),
                ErrorCode.SOCIAL_ALREADY_LINKED);
    }

    @Test
    void kakaoOutageIsNotChanged() {
        when(kakao.fetchProfile("code", REDIRECT))
                .thenThrow(new ApiException(ErrorCode.SOCIAL_LOGIN_UNAVAILABLE));

        assertCode(
                () -> service.link(USER_ID, "KAKAO", "code", REDIRECT),
                ErrorCode.SOCIAL_LOGIN_UNAVAILABLE);
        verify(socialAccounts, never()).saveAndFlush(any());
    }

    @Test
    void socialUserCannotUnlink() {
        User social = User.social("k@kakao.com", "카카오");
        when(users.findActiveForUpdate(USER_ID)).thenReturn(Optional.of(social));

        assertCode(() -> service.unlink(USER_ID, "kakao"), ErrorCode.PASSWORD_NOT_SET);
        verify(socialAccounts, never()).delete(any());
        verify(alarms, never()).findForUpdate(USER_ID);
    }

    private static void assertCode(Runnable call, ErrorCode code) {
        assertThatThrownBy(call::run)
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.errorCode()).isEqualTo(code));
    }
}
