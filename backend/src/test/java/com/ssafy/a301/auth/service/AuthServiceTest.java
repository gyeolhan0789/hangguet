package com.ssafy.a301.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
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
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.TermsType;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserAgreementRepository;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;

class AuthServiceTest {
    private final UserRepository users = mock(UserRepository.class);
    private final UserAgreementRepository agreements = mock(UserAgreementRepository.class);
    private final PasswordEncoder passwords = mock(PasswordEncoder.class);
    private final AccessTokens access = mock(AccessTokens.class);
    private final RefreshTokenStore refresh = mock(RefreshTokenStore.class);
    private final TransactionTemplate transactions = mock(TransactionTemplate.class);
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
                        new AuthProperties(
                                "test-secret-at-least-thirty-two-bytes",
                                Duration.ofHours(1),
                                Duration.ofDays(30)),
                        transactions);
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
        when(users.existsByEmailAndDeletedAtIsNull("a@test.com")).thenReturn(true);
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
        when(users.findByEmailAndDeletedAtIsNull("a@test.com")).thenReturn(Optional.empty());
        assertCode(
                () -> service.login(new LoginRequest("a@test.com", "wrong")),
                ErrorCode.LOGIN_FAILED);
        when(users.findByEmailAndDeletedAtIsNull("a@test.com"))
                .thenReturn(Optional.of(new User("a@test.com", "hash", "회원")));
        when(passwords.matches("wrong", "hash")).thenReturn(false);
        assertCode(
                () -> service.login(new LoginRequest("a@test.com", "wrong")),
                ErrorCode.LOGIN_FAILED);
    }

    @Test
    void refreshRotatesAndRejectsReusedToken() {
        when(refresh.consume("old")).thenReturn(7L).thenReturn(null);
        when(users.findByIdAndDeletedAtIsNull(7L))
                .thenReturn(Optional.of(new User("a@test.com", "hash", "회원")));
        when(access.issue(7L, "회원")).thenReturn("access");
        when(refresh.issue(7L)).thenReturn("new");
        assertThat(service.refresh("old").refreshToken()).isEqualTo("new");
        assertCode(() -> service.refresh("old"), ErrorCode.REFRESH_TOKEN_INVALID);
    }

    @Test
    void withdrawnUserCannotRefresh() {
        when(refresh.consume("old")).thenReturn(7L);
        when(users.findByIdAndDeletedAtIsNull(7L)).thenReturn(Optional.empty());
        assertCode(() -> service.refresh("old"), ErrorCode.REFRESH_TOKEN_INVALID);
        verify(refresh, never()).issue(7L);
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
