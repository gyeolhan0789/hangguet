package com.ssafy.a301.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.auth.dto.AgreementRequest;
import com.ssafy.a301.auth.dto.LoginRequest;
import com.ssafy.a301.auth.dto.SignupRequest;
import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.auth.repository.RefreshTokenStore;
import com.ssafy.a301.auth.repository.RefreshTokenStore.RefreshSession;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.storage.s3.S3FileStorage;
import com.ssafy.a301.user.domain.TermsType;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.PasswordChangeRepository;
import com.ssafy.a301.user.repository.UserAgreementRepository;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

class AuthServiceTest {
    private static final Instant LOGGED_IN = Instant.parse("2026-10-26T01:00:00Z");
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private final UserRepository users = mock(UserRepository.class);
    private final UserAgreementRepository agreements = mock(UserAgreementRepository.class);
    private final PasswordEncoder passwords = mock(PasswordEncoder.class);
    private final AccessTokens access = mock(AccessTokens.class);
    private final RefreshTokenStore refresh = mock(RefreshTokenStore.class);
    private final PasswordChangeRepository passwordChanges = mock(PasswordChangeRepository.class);
    private final TransactionTemplate transactions = mock(TransactionTemplate.class);
    private final S3FileStorage storage = mock(S3FileStorage.class);
    private AuthService service;

    @BeforeEach
    void setUp() {
        service =
                new AuthService(
                        users,
                        agreements,
                        passwords,
                        access,
                        refresh,
                        passwordChanges,
                        new AuthProperties(
                                "test-secret-at-least-thirty-two-bytes",
                                Duration.ofHours(1),
                                Duration.ofDays(30)),
                        transactions,
                        storage);
    }

    @Test
    void duplicateAgreementsAreRejected() {
        var consent = new AgreementRequest(TermsType.TERMS, "1.0");
        assertCode(
                () ->
                        service.signup(
                                new SignupRequest(
                                        "a@test.com",
                                        "abcd1234",
                                        "회원",
                                        List.of(consent, consent, consent))),
                ErrorCode.AGREEMENT_REQUIRED);
        verify(users, never()).saveAndFlush(any());
    }

    @Test
    void duplicateEmailIsRejectedBeforeSaving() {
        when(users.existsActiveByEmail("a@test.com")).thenReturn(true);
        var terms =
                List.of(
                        new AgreementRequest(TermsType.TERMS, "1.0"),
                        new AgreementRequest(TermsType.PRIVACY, "1.0"),
                        new AgreementRequest(TermsType.RECORDING, "1.0"));
        assertCode(
                () -> service.signup(new SignupRequest("a@test.com", "abcd1234", "회원", terms)),
                ErrorCode.EMAIL_DUPLICATED);
    }

    @Test
    void emailIsComparedCaseInsensitivelyForAvailabilityAndLogin() {
        when(users.existsActiveByEmail("a@test.com")).thenReturn(true);
        assertThat(service.isEmailAvailable("  A@Test.COM ")).isFalse();

        var user = new User("A@Test.com", "hash", "회원");
        ReflectionTestUtils.setField(user, "id", 7L);
        assertThat(user.getEmail()).isEqualTo("a@test.com");
        when(users.findActiveByEmail("a@test.com")).thenReturn(List.of(user));
        when(passwords.matches("abcd1234", "hash")).thenReturn(true);
        assertThat(service.login(new LoginRequest("A@TEST.com", "abcd1234")).user()).isNotNull();
    }

    @Test
    void missingAgreementIsRejected() {
        assertCode(
                () ->
                        service.signup(
                                new SignupRequest(
                                        "a@test.com",
                                        "abcd1234",
                                        "회원",
                                        List.of(
                                                new AgreementRequest(TermsType.TERMS, "1.0"),
                                                new AgreementRequest(TermsType.PRIVACY, "1.0")))),
                ErrorCode.AGREEMENT_REQUIRED);
        verify(users, never()).saveAndFlush(any());
    }

    @Test
    void unknownUserAndWrongPasswordHaveSameError() {
        when(users.findActiveByEmail("a@test.com")).thenReturn(List.of());
        assertCode(
                () -> service.login(new LoginRequest("a@test.com", "wrong")),
                ErrorCode.LOGIN_FAILED);
        when(users.findActiveByEmail("a@test.com"))
                .thenReturn(List.of(new User("a@test.com", "hash", "회원")));
        when(passwords.matches("wrong", "hash")).thenReturn(false);
        assertCode(
                () -> service.login(new LoginRequest("a@test.com", "wrong")),
                ErrorCode.LOGIN_FAILED);
    }

    @Test
    void legacyAccountsDifferingOnlyInCaseLogInByPassword() {
        // 소문자로 저장하기 전에 대소문자만 다르게 가입한 두 계정
        var upper = new User("A@test.com", "hash-upper", "대문자");
        ReflectionTestUtils.setField(upper, "id", 7L);
        var lower = new User("a@test.com", "hash-lower", "소문자");
        ReflectionTestUtils.setField(lower, "id", 8L);
        when(users.findActiveByEmail("a@test.com")).thenReturn(List.of(upper, lower));
        when(passwords.matches("pw-lower", "hash-lower")).thenReturn(true);
        when(access.issue(8L, "소문자")).thenReturn("access-lower");

        assertThat(service.login(new LoginRequest("a@test.com", "pw-lower")).accessToken())
                .isEqualTo("access-lower");
        assertCode(
                () -> service.login(new LoginRequest("a@test.com", "wrong")),
                ErrorCode.LOGIN_FAILED);
    }

    @Test
    void loginResponseHasProfileImageUrl() {
        var user = new User("a@test.com", "hash", "회원");
        ReflectionTestUtils.setField(user, "id", 7L);
        user.changeProfileImage("profile/7/a.png");
        when(users.findActiveByEmail("a@test.com")).thenReturn(List.of(user));
        when(passwords.matches("abcd1234", "hash")).thenReturn(true);
        when(storage.presignDownload("profile/7/a.png")).thenReturn("https://s3/get");

        assertThat(
                        service.login(new LoginRequest("a@test.com", "abcd1234"))
                                .user()
                                .profileImageUrl())
                .isEqualTo("https://s3/get");
    }

    @Test
    void refreshRotatesKeepingLoginTimeAndRejectsReusedToken() {
        when(refresh.consume("old")).thenReturn(new RefreshSession(7L, LOGGED_IN)).thenReturn(null);
        when(users.findByIdAndDeletedAtIsNull(7L))
                .thenReturn(Optional.of(new User("a@test.com", "hash", "회원")));
        when(passwordChanges.findLatestChangedAt(7L)).thenReturn(Optional.empty());
        when(access.issue(7L, "회원")).thenReturn("access");
        when(refresh.issue(7L, LOGGED_IN)).thenReturn("new");
        assertThat(service.refresh("old").refreshToken()).isEqualTo("new");
        assertCode(() -> service.refresh("old"), ErrorCode.REFRESH_TOKEN_INVALID);
    }

    @Test
    void withdrawnUserCannotRefresh() {
        when(refresh.consume("old")).thenReturn(new RefreshSession(7L, LOGGED_IN));
        when(users.findByIdAndDeletedAtIsNull(7L)).thenReturn(Optional.empty());
        assertCode(() -> service.refresh("old"), ErrorCode.REFRESH_TOKEN_INVALID);
        verify(refresh, never()).issue(anyLong(), any());
    }

    @Test
    void passwordChangedByAdminAfterLoginBlocksRefresh() {
        // 비밀번호 변경 때 토큰 폐기가 실패했거나 재발급과 겹쳐 토큰이 남아 있어도 재발급하지 않는다
        when(refresh.consume("old")).thenReturn(new RefreshSession(7L, LOGGED_IN));
        when(users.findByIdAndDeletedAtIsNull(7L))
                .thenReturn(Optional.of(new User("a@test.com", "hash", "회원")));
        when(passwordChanges.findLatestChangedAt(7L))
                .thenReturn(Optional.of(OffsetDateTime.ofInstant(LOGGED_IN.plusSeconds(60), KST)));
        assertCode(() -> service.refresh("old"), ErrorCode.REFRESH_TOKEN_INVALID);
        verify(refresh, never()).issue(anyLong(), any());
    }

    @Test
    void loginAfterPasswordChangeCanRefresh() {
        when(refresh.consume("old")).thenReturn(new RefreshSession(7L, LOGGED_IN));
        when(users.findByIdAndDeletedAtIsNull(7L))
                .thenReturn(Optional.of(new User("a@test.com", "hash", "회원")));
        when(passwordChanges.findLatestChangedAt(7L))
                .thenReturn(Optional.of(OffsetDateTime.ofInstant(LOGGED_IN.minusSeconds(60), KST)));
        when(refresh.issue(7L, LOGGED_IN)).thenReturn("new");
        assertThat(service.refresh("old").refreshToken()).isEqualTo("new");
    }

    @Test
    void logoutPassesAuthenticatedOwnerForRevocation() {
        service.logout(7L, "token");
        service.logout(7L, "token");
        verify(refresh, org.mockito.Mockito.times(2)).revoke("token", 7L);
    }

    private static void assertCode(Runnable operation, ErrorCode expected) {
        assertThatThrownBy(operation::run)
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.errorCode()).isEqualTo(expected));
    }
}
