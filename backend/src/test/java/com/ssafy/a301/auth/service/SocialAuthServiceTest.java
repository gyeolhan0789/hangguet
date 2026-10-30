package com.ssafy.a301.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.auth.dto.AgreementRequest;
import com.ssafy.a301.auth.dto.SocialSignupRequest;
import com.ssafy.a301.auth.dto.TokenResponse;
import com.ssafy.a301.auth.oauth.OAuthProperties;
import com.ssafy.a301.auth.oauth.SocialLoginClient;
import com.ssafy.a301.auth.oauth.SocialProfile;
import com.ssafy.a301.auth.repository.SocialSignupStore;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.user.domain.SocialProvider;
import com.ssafy.a301.user.domain.TermsType;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.domain.UserSocialAccount;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.repository.UserSocialAccountRepository;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.function.Executable;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class SocialAuthServiceTest {
    private static final SocialProfile PROFILE =
            new SocialProfile(SocialProvider.KAKAO, "12345", "K@Kakao.com", "카카오");
    private static final List<AgreementRequest> ALL_TERMS =
            List.of(
                    new AgreementRequest(TermsType.TERMS, "1.0"),
                    new AgreementRequest(TermsType.PRIVACY, "1.0"),
                    new AgreementRequest(TermsType.RECORDING, "1.0"));
    private final SocialLoginClient kakao = mock(SocialLoginClient.class);
    private final AuthService auth = mock(AuthService.class);
    private final UserRepository users = mock(UserRepository.class);
    private final UserSocialAccountRepository socialAccounts =
            mock(UserSocialAccountRepository.class);
    private final SocialSignupStore signups = mock(SocialSignupStore.class);
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
    private final TokenResponse tokens = new TokenResponse("access", "refresh", 3600, null);
    private SocialAuthService service;

    @BeforeEach
    void setUp() {
        when(kakao.provider()).thenReturn(SocialProvider.KAKAO);
        service =
                new SocialAuthService(
                        List.of(kakao),
                        auth,
                        users,
                        socialAccounts,
                        signups,
                        new OAuthProperties(
                                Duration.ofMinutes(10), Duration.ofSeconds(5), null, null),
                        new TransactionTemplate(txManager));
        when(kakao.fetchProfile("code", "https://a301/callback")).thenReturn(PROFILE);
        when(auth.isEmailAvailable("K@Kakao.com")).thenReturn(true);
        when(auth.tokens(any())).thenReturn(tokens);
    }

    @Test
    void linkedUserLogsInWithoutSignup() {
        User user = withId(User.social("k@kakao.com", "카카오"), 7);
        when(socialAccounts.findActive(SocialProvider.KAKAO, "12345"))
                .thenReturn(
                        Optional.of(new UserSocialAccount(user, SocialProvider.KAKAO, "12345")));

        var response = service.login("kakao", "code", "https://a301/callback");

        assertThat(response.signupRequired()).isFalse();
        assertThat(response.token()).isSameAs(tokens);
        assertThat(response.signup()).isNull();
        verify(signups, never()).issue(any());
    }

    @Test
    void newcomerGetsSignupTokenWithProfile() {
        when(signups.issue(PROFILE)).thenReturn("signup-token");

        var response = service.login("KAKAO", "code", "https://a301/callback");

        assertThat(response.signupRequired()).isTrue();
        assertThat(response.token()).isNull();
        assertThat(response.signup().signupToken()).isEqualTo("signup-token");
        assertThat(response.signup().email()).isEqualTo("k@kakao.com");
        assertThat(response.signup().nickname()).isEqualTo("카카오");
        assertThat(response.signup().expiresIn()).isEqualTo(600);
    }

    @Test
    void newcomerWithoutEmailOrWithUsedEmailIsRejected() {
        when(kakao.fetchProfile("no-email", "https://a301/callback"))
                .thenReturn(new SocialProfile(SocialProvider.KAKAO, "1", null, "카카오"));
        assertCode(
                () -> service.login("kakao", "no-email", "https://a301/callback"),
                ErrorCode.SOCIAL_EMAIL_REQUIRED);

        when(auth.isEmailAvailable("K@Kakao.com")).thenReturn(false);
        assertCode(
                () -> service.login("kakao", "code", "https://a301/callback"),
                ErrorCode.SOCIAL_EMAIL_DUPLICATED);
        verify(signups, never()).issue(any());
    }

    @Test
    void unknownProviderIsValidationError() {
        assertThatThrownBy(() -> service.login("naver", "code", "https://a301/callback"))
                .isInstanceOf(FieldValidationException.class);
    }

    @Test
    void signupCreatesPasswordlessUserWithAgreementsAndLink() {
        when(signups.find("signup-token")).thenReturn(PROFILE);
        when(users.saveAndFlush(any())).thenAnswer(call -> withId(call.getArgument(0), 7));

        assertThat(service.signup(new SocialSignupRequest("signup-token", ALL_TERMS)))
                .isSameAs(tokens);

        ArgumentCaptor<User> user = ArgumentCaptor.forClass(User.class);
        verify(users).saveAndFlush(user.capture());
        assertThat(user.getValue().getEmail()).isEqualTo("k@kakao.com");
        assertThat(user.getValue().hasPassword()).isFalse();
        verify(auth).saveAgreements(user.getValue(), ALL_TERMS);
        ArgumentCaptor<UserSocialAccount> link = ArgumentCaptor.forClass(UserSocialAccount.class);
        verify(socialAccounts).saveAndFlush(link.capture());
        assertThat(link.getValue().getProviderUserId()).isEqualTo("12345");
        // 커밋한 뒤 로그인 토큰을 만들고 가입 토큰을 지운다
        var order = inOrder(txManager, signups, auth);
        order.verify(txManager).commit(any());
        order.verify(signups).delete("signup-token");
        order.verify(auth).tokens(user.getValue());
    }

    @Test
    void failedSignupKeepsSignupTokenForRetry() {
        when(signups.find("signup-token")).thenReturn(PROFILE);
        when(auth.isEmailAvailable("K@Kakao.com")).thenReturn(false);

        assertCode(
                () -> service.signup(new SocialSignupRequest("signup-token", ALL_TERMS)),
                ErrorCode.SOCIAL_EMAIL_DUPLICATED);
        verify(txManager).rollback(any());
        verify(signups, never()).delete(any());
        verify(auth, never()).tokens(any());
    }

    @Test
    void repeatedSignupTokenLogsIntoSameUserWithoutCreating() {
        User first = withId(User.social("k@kakao.com", "카카오"), 7);
        when(signups.find("signup-token")).thenReturn(PROFILE);
        when(socialAccounts.findActive(SocialProvider.KAKAO, "12345"))
                .thenReturn(
                        Optional.of(new UserSocialAccount(first, SocialProvider.KAKAO, "12345")));

        assertThat(service.signup(new SocialSignupRequest("signup-token", ALL_TERMS)))
                .isSameAs(tokens);
        verify(users, never()).saveAndFlush(any());
        verify(auth).tokens(first);
    }

    @Test
    void missingAgreementKeepsSignupToken() {
        assertCode(
                () ->
                        service.signup(
                                new SocialSignupRequest("signup-token", ALL_TERMS.subList(0, 2))),
                ErrorCode.AGREEMENT_REQUIRED);
        verify(signups, never()).find(any());
    }

    @Test
    void usedOrExpiredSignupTokenIsRejected() {
        assertCode(
                () -> service.signup(new SocialSignupRequest("used", ALL_TERMS)),
                ErrorCode.SIGNUP_TOKEN_INVALID);
        verify(users, never()).saveAndFlush(any());
    }

    @Test
    void concurrentSignupOfSameAccountLogsIntoFirstUser() {
        User first = withId(User.social("k@kakao.com", "카카오"), 7);
        when(signups.find("signup-token")).thenReturn(PROFILE);
        when(users.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("dup"));
        when(socialAccounts.findActive(SocialProvider.KAKAO, "12345"))
                .thenReturn(Optional.empty())
                .thenReturn(
                        Optional.of(new UserSocialAccount(first, SocialProvider.KAKAO, "12345")));

        assertThat(service.signup(new SocialSignupRequest("signup-token", ALL_TERMS)))
                .isSameAs(tokens);
        verify(auth).tokens(first);
    }

    @Test
    void concurrentSignupWithSameEmailIsConflictAndOtherFailureIsKept() {
        var dup = new DataIntegrityViolationException("dup");
        when(signups.find("signup-token")).thenReturn(PROFILE);
        when(users.saveAndFlush(any())).thenThrow(dup);
        when(auth.isEmailAvailable("K@Kakao.com")).thenReturn(true, false);
        assertCode(
                () -> service.signup(new SocialSignupRequest("signup-token", ALL_TERMS)),
                ErrorCode.SOCIAL_EMAIL_DUPLICATED);

        when(auth.isEmailAvailable("K@Kakao.com")).thenReturn(true);
        assertThatThrownBy(() -> service.signup(new SocialSignupRequest("signup-token", ALL_TERMS)))
                .isSameAs(dup);
        verify(signups, never()).delete(any());
    }

    @Test
    void nicknameFallsBackAndIsCutToFiftyCharacters() {
        assertThat(SocialAuthService.nicknameOf(profileNamed(null)))
                .isEqualTo(SocialAuthService.DEFAULT_NICKNAME);
        assertThat(SocialAuthService.nicknameOf(profileNamed("  ")))
                .isEqualTo(SocialAuthService.DEFAULT_NICKNAME);
        assertThat(SocialAuthService.nicknameOf(profileNamed("가".repeat(60)))).hasSize(50);
    }

    private static SocialProfile profileNamed(String nickname) {
        return new SocialProfile(SocialProvider.KAKAO, "1", "a@kakao.com", nickname);
    }

    private static User withId(User user, long id) {
        ReflectionTestUtils.setField(user, "id", id);
        return user;
    }

    private static void assertCode(Executable call, ErrorCode code) {
        assertThatThrownBy(call::execute)
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.errorCode()).isEqualTo(code));
    }
}
