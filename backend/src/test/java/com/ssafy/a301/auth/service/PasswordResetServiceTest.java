package com.ssafy.a301.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.auth.repository.PasswordResetTokenStore;
import com.ssafy.a301.auth.repository.PasswordResetTokenStore.ResetToken;
import com.ssafy.a301.auth.reset.PasswordResetMailer;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.service.PasswordChangeService;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class PasswordResetServiceTest {
    private final UserRepository users = mock(UserRepository.class);
    private final PasswordResetTokenStore tokens = mock(PasswordResetTokenStore.class);
    private final PasswordResetMailer mailer = mock(PasswordResetMailer.class);
    private final PasswordChangeService passwordChanges = mock(PasswordChangeService.class);
    private final PasswordResetService service =
            new PasswordResetService(users, tokens, mailer, passwordChanges);

    @Test
    void emailUserGetsLinkForNormalizedEmail() {
        var user = new User("a@test.com", "hash", "회원");
        ReflectionTestUtils.setField(user, "id", 7L);
        when(tokens.tryStartResendInterval("a@test.com")).thenReturn(true);
        when(users.findActiveByEmail("a@test.com")).thenReturn(List.of(user));
        when(tokens.issue(7L)).thenReturn("token-1");

        service.request(" A@Test.com ");

        verify(mailer).send("a@test.com", "token-1");
    }

    @Test
    void unknownEmailAndSocialUserGetNoMail() {
        when(tokens.tryStartResendInterval(any())).thenReturn(true);
        when(users.findActiveByEmail("none@test.com")).thenReturn(List.of());
        when(users.findActiveByEmail("k@kakao.com"))
                .thenReturn(List.of(User.social("k@kakao.com", "카카오")));

        service.request("none@test.com");
        service.request("k@kakao.com");

        verify(tokens, never()).issue(anyLong());
        verify(mailer, never()).send(any(), any());
    }

    @Test
    void requestWithinResendIntervalSendsNothing() {
        when(tokens.tryStartResendInterval("a@test.com")).thenReturn(false);

        service.request("a@test.com");

        verify(users, never()).findActiveByEmail(any());
        verify(mailer, never()).send(any(), any());
    }

    @Test
    void confirmChangesPasswordWithTokenOwnerAndIssueTime() {
        Instant issuedAt = Instant.parse("2026-11-08T01:00:00Z");
        when(tokens.consume("token-1")).thenReturn(new ResetToken(7L, issuedAt));

        service.confirm("token-1", "newpass1");

        verify(passwordChanges).changeByReset(7L, "newpass1", issuedAt);
    }

    @Test
    void unknownOrUsedTokenIsRejected() {
        when(tokens.consume("used")).thenReturn(null);

        assertThatThrownBy(() -> service.confirm("used", "newpass1"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        ex ->
                                assertThat(ex.errorCode())
                                        .isEqualTo(ErrorCode.PASSWORD_RESET_TOKEN_INVALID));
        verify(passwordChanges, never()).changeByReset(anyLong(), any(), any());
    }
}
