package com.ssafy.a301.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.auth.repository.RefreshTokenStore;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.PasswordChange;
import com.ssafy.a301.user.domain.PasswordChangedBy;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.PasswordChangeRepository;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class PasswordChangeServiceTest {
    private static final long USER_ID = 7L;

    private final UserRepository users = mock(UserRepository.class);
    private final PasswordChangeRepository changes = mock(PasswordChangeRepository.class);
    private final PasswordEncoder passwords = mock(PasswordEncoder.class);
    private final RefreshTokenStore refreshTokens = mock(RefreshTokenStore.class);
    private final AccessTokens accessTokens = mock(AccessTokens.class);
    // 실제 TransactionTemplate으로 콜백을 실행하고, 커밋·롤백은 가짜 매니저로 확인한다
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
    private PasswordChangeService service;
    private User user;

    @BeforeEach
    void setUp() {
        service =
                new PasswordChangeService(
                        users,
                        changes,
                        passwords,
                        refreshTokens,
                        accessTokens,
                        new AuthProperties(
                                "test-secret-at-least-thirty-two-bytes",
                                Duration.ofHours(1),
                                Duration.ofDays(30)),
                        new TransactionTemplate(txManager));
        user = new User("a@test.com", "hash", "면접왕");
        ReflectionTestUtils.setField(user, "id", USER_ID);
        when(users.findActiveForUpdate(USER_ID)).thenReturn(Optional.of(user));
    }

    @Test
    void userChangeRecordsRevokesOthersThenIssuesTokensForThisDevice() {
        when(passwords.matches("current1", "hash")).thenReturn(true);
        when(passwords.encode("newpass1")).thenReturn("new-hash");
        when(accessTokens.issue(USER_ID, "면접왕")).thenReturn("new-access");
        when(refreshTokens.issue(any(Long.class), any(Instant.class))).thenReturn("new-refresh");

        var response = service.changeByUser(USER_ID, "current1", "newpass1");

        assertThat(user.getPasswordHash()).isEqualTo("new-hash");
        verify(txManager).commit(any());
        ArgumentCaptor<PasswordChange> saved = ArgumentCaptor.forClass(PasswordChange.class);
        verify(changes).save(saved.capture());
        assertThat(saved.getValue().getChangedBy()).isEqualTo(PasswordChangedBy.USER);
        assertThat(saved.getValue().getAdminId()).isNull();
        // 모두 폐기한 뒤 이 기기 토큰을 만든다. 새 토큰의 로그인 시각은 변경 기록 시각과 같아 재발급(1.4)에서 막히지 않는다
        var order = inOrder(refreshTokens);
        order.verify(refreshTokens).revokeAll(USER_ID);
        order.verify(refreshTokens).issue(USER_ID, saved.getValue().getChangedAt().toInstant());
        assertThat(response.accessToken()).isEqualTo("new-access");
        assertThat(response.refreshToken()).isEqualTo("new-refresh");
        assertThat(response.expiresIn()).isEqualTo(3600);
    }

    @Test
    void wrongCurrentPasswordChangesNothing() {
        when(passwords.matches("wrong123", "hash")).thenReturn(false);

        assertThatThrownBy(() -> service.changeByUser(USER_ID, "wrong123", "newpass1"))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(ErrorCode.PASSWORD_MISMATCH));
        assertThat(user.getPasswordHash()).isEqualTo("hash");
        verify(txManager, never()).commit(any());
        verify(changes, never()).save(any());
        verify(refreshTokens, never()).revokeAll(anyLong());
    }

    @Test
    void socialUserHasNoPasswordToChange() {
        User social = User.social("k@kakao.com", "카카오");
        ReflectionTestUtils.setField(social, "id", USER_ID);
        when(users.findActiveForUpdate(USER_ID)).thenReturn(Optional.of(social));

        for (Runnable change :
                new Runnable[] {
                    () -> service.changeByUser(USER_ID, "current1", "newpass1"),
                    () -> service.changeByAdmin(USER_ID, 1L, "newpass1", null)
                }) {
            assertThatThrownBy(change::run)
                    .isInstanceOfSatisfying(
                            ApiException.class,
                            ex -> assertThat(ex.errorCode()).isEqualTo(ErrorCode.PASSWORD_NOT_SET));
        }
        assertThat(social.hasPassword()).isFalse();
        verify(changes, never()).save(any());
        verify(refreshTokens, never()).revokeAll(anyLong());
    }

    @Test
    void revokeFailureStillIssuesTokensForThisDevice() {
        when(passwords.matches("current1", "hash")).thenReturn(true);
        doThrow(new RedisConnectionFailureException("down")).when(refreshTokens).revokeAll(USER_ID);
        when(refreshTokens.issue(any(Long.class), any(Instant.class))).thenReturn("new-refresh");

        // 남은 다른 기기 토큰은 재발급 때 변경 기록 시각으로 막힌다
        assertThat(service.changeByUser(USER_ID, "current1", "newpass1").refreshToken())
                .isEqualTo("new-refresh");
    }
}
