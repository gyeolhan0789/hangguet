package com.ssafy.a301.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
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
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.practice.repository.PracticeLogRepository;
import com.ssafy.a301.practice.service.PracticeService;
import com.ssafy.a301.storage.domain.UploadPurpose;
import com.ssafy.a301.storage.repository.UploadKeyStore;
import com.ssafy.a301.storage.s3.PresignedUrl;
import com.ssafy.a301.storage.s3.S3FileStorage;
import com.ssafy.a301.storage.s3.S3Properties;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import software.amazon.awssdk.core.exception.SdkClientException;

class UserServiceTest {
    private static final long USER_ID = 7L;
    private static final Duration UPLOAD_TTL = Duration.ofMinutes(10);

    private final UserRepository users = mock(UserRepository.class);
    private final PracticeLogRepository practiceLogs = mock(PracticeLogRepository.class);
    private final PasswordEncoder passwords = mock(PasswordEncoder.class);
    private final AccessTokens access = mock(AccessTokens.class);
    private final S3FileStorage storage = mock(S3FileStorage.class);
    private final UploadKeyStore uploadKeys = mock(UploadKeyStore.class);
    private final RefreshTokenStore refreshTokens = mock(RefreshTokenStore.class);
    // 실제 TransactionTemplate으로 콜백을 실행하고, 커밋·롤백은 가짜 매니저로 확인한다
    private final PlatformTransactionManager txManager = mock(PlatformTransactionManager.class);
    private UserService service;
    private User user;

    @BeforeEach
    void setUp() {
        service =
                new UserService(
                        users,
                        new PracticeService(practiceLogs),
                        passwords,
                        access,
                        new AuthProperties(
                                "test-secret-at-least-thirty-two-bytes",
                                Duration.ofHours(1),
                                Duration.ofDays(30)),
                        storage,
                        new S3Properties(
                                "bucket", "ap-northeast-2", UPLOAD_TTL, Duration.ofHours(1)),
                        uploadKeys,
                        refreshTokens,
                        new TransactionTemplate(txManager));
        user = new User("a@test.com", "hash", "이전닉네임");
        ReflectionTestUtils.setField(user, "id", USER_ID);
        when(users.findByIdAndDeletedAtIsNull(USER_ID)).thenReturn(Optional.of(user));
        when(users.findActiveForUpdate(USER_ID)).thenReturn(Optional.of(user));
        when(practiceLogs.findPracticeDatesByUserId(USER_ID)).thenReturn(List.of());
    }

    @Test
    void meHasCurrentStreakAndNoImageUrlWithoutImage() {
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Seoul"));
        when(practiceLogs.findPracticeDatesByUserId(USER_ID))
                .thenReturn(List.of(today.minusDays(1), today.minusDays(2)));

        var me = service.me(USER_ID);

        assertThat(me.currentStreak()).isEqualTo(2);
        assertThat(me.profileImageUrl()).isNull();
    }

    @Test
    void meHasPresignedImageUrl() {
        user.changeProfileImage("profile/7/a.png");
        when(storage.presignDownload("profile/7/a.png")).thenReturn("https://s3/get");

        assertThat(service.me(USER_ID).profileImageUrl()).isEqualTo("https://s3/get");
    }

    @Test
    void withdrawnUserIsUnauthorized() {
        when(users.findByIdAndDeletedAtIsNull(USER_ID)).thenReturn(Optional.empty());
        when(users.findActiveForUpdate(USER_ID)).thenReturn(Optional.empty());

        assertCode(() -> service.me(USER_ID), ErrorCode.UNAUTHORIZED);
        assertCode(() -> service.changeNickname(USER_ID, "새닉네임"), ErrorCode.UNAUTHORIZED);
    }

    @Test
    void nicknameChangeIssuesTokenWithNewNickname() {
        when(access.issue(USER_ID, "새닉네임")).thenReturn("new-access");

        var response = service.changeNickname(USER_ID, " 새닉네임 ");

        assertThat(user.getNickname()).isEqualTo("새닉네임");
        verify(txManager).commit(any());
        assertThat(response.nickname()).isEqualTo("새닉네임");
        assertThat(response.accessToken()).isEqualTo("new-access");
        assertThat(response.expiresIn()).isEqualTo(3600);
    }

    @Test
    void uploadUrlUsesOwnKeyAndRecordsIssue() {
        var expiresAt = OffsetDateTime.now();
        when(storage.presignUpload(anyString(), eq("image/png"), eq(1024L)))
                .thenReturn(new PresignedUrl("https://s3/put", expiresAt));

        var response = service.profileImageUploadUrl(USER_ID, "image/png", 1024);

        assertThat(response.objectKey()).matches("profile/7/[0-9a-f-]{36}\\.png");
        assertThat(response.uploadUrl()).isEqualTo("https://s3/put");
        assertThat(response.expiresAt()).isEqualTo(expiresAt);
        verify(uploadKeys)
                .issue(response.objectKey(), USER_ID, UploadPurpose.PROFILE_IMAGE, UPLOAD_TTL);
    }

    @Test
    void jpegUploadKeyHasJpgExtension() {
        when(storage.presignUpload(anyString(), eq("image/jpeg"), eq(1L)))
                .thenReturn(new PresignedUrl("https://s3/put", OffsetDateTime.now()));

        assertThat(service.profileImageUploadUrl(USER_ID, "image/jpeg", 1).objectKey())
                .endsWith(".jpg");
    }

    @Test
    void keyNotIssuedToUserIsRejected() {
        when(uploadKeys.isIssuedTo("profile/8/b.png", USER_ID, UploadPurpose.PROFILE_IMAGE))
                .thenReturn(false);

        assertThatThrownBy(() -> service.registerProfileImage(USER_ID, "profile/8/b.png"))
                .isInstanceOfSatisfying(
                        FieldValidationException.class,
                        ex -> assertThat(ex.field()).isEqualTo("objectKey"));
        verify(storage, never()).exists(anyString());
        verify(txManager, never()).commit(any());
    }

    @Test
    void missingFileIsNotFound() {
        when(uploadKeys.isIssuedTo("profile/7/b.png", USER_ID, UploadPurpose.PROFILE_IMAGE))
                .thenReturn(true);
        when(storage.exists("profile/7/b.png")).thenReturn(false);

        assertCode(
                () -> service.registerProfileImage(USER_ID, "profile/7/b.png"),
                ErrorCode.FILE_NOT_FOUND);
        verify(txManager, never()).commit(any());
    }

    @Test
    void registeringReplacesImageAndDeletesPreviousFile() {
        user.changeProfileImage("profile/7/old.png");
        when(uploadKeys.isIssuedTo("profile/7/new.png", USER_ID, UploadPurpose.PROFILE_IMAGE))
                .thenReturn(true);
        when(storage.exists("profile/7/new.png")).thenReturn(true);
        when(storage.presignDownload("profile/7/new.png")).thenReturn("https://s3/new");

        var me = service.registerProfileImage(USER_ID, "profile/7/new.png");

        assertThat(user.getProfileImageKey()).isEqualTo("profile/7/new.png");
        assertThat(me.profileImageUrl()).isEqualTo("https://s3/new");
        var order = inOrder(txManager, storage);
        order.verify(txManager).commit(any());
        order.verify(storage).delete("profile/7/old.png");
    }

    @Test
    void registeringSameKeyAgainKeepsFile() {
        user.changeProfileImage("profile/7/a.png");
        when(uploadKeys.isIssuedTo("profile/7/a.png", USER_ID, UploadPurpose.PROFILE_IMAGE))
                .thenReturn(true);
        when(storage.exists("profile/7/a.png")).thenReturn(true);

        service.registerProfileImage(USER_ID, "profile/7/a.png");

        verify(storage, never()).delete(anyString());
    }

    @Test
    void failedFileDeletionDoesNotFailRequest() {
        user.changeProfileImage("profile/7/a.png");
        doThrow(SdkClientException.create("down")).when(storage).delete("profile/7/a.png");

        service.deleteProfileImage(USER_ID);

        assertThat(user.getProfileImageKey()).isNull();
        verify(txManager).commit(any());
    }

    @Test
    void withdrawalMarksUserAndRevokesAllTokens() {
        when(passwords.matches("abcd1234", "hash")).thenReturn(true);

        service.withdraw(USER_ID, "abcd1234");

        assertThat(user.isWithdrawn()).isTrue();
        var order = inOrder(txManager, refreshTokens);
        order.verify(txManager).commit(any());
        order.verify(refreshTokens).revokeAll(USER_ID);
    }

    @Test
    void withdrawalWithWrongPasswordChangesNothing() {
        when(passwords.matches("wrong123", "hash")).thenReturn(false);

        assertCode(() -> service.withdraw(USER_ID, "wrong123"), ErrorCode.PASSWORD_MISMATCH);
        assertThat(user.isWithdrawn()).isFalse();
        verify(txManager, never()).commit(any());
        verify(txManager).rollback(any());
        verify(refreshTokens, never()).revokeAll(USER_ID);
    }

    @Test
    void softDeleteKeepsPersonalDataAndProfileImage() {
        user.changeProfileImage("profile/7/a.png");
        when(passwords.matches("abcd1234", "hash")).thenReturn(true);

        service.withdraw(USER_ID, "abcd1234");

        assertThat(user.getEmail()).isEqualTo("a@test.com");
        assertThat(user.getNickname()).isEqualTo("이전닉네임");
        assertThat(user.getProfileImageKey()).isEqualTo("profile/7/a.png");
        verify(storage, never()).delete(anyString());
    }

    @Test
    void withdrawalSucceedsEvenIfTokenCleanupFails() {
        when(passwords.matches("abcd1234", "hash")).thenReturn(true);
        doThrow(new RedisConnectionFailureException("down")).when(refreshTokens).revokeAll(USER_ID);

        service.withdraw(USER_ID, "abcd1234");

        assertThat(user.isWithdrawn()).isTrue();
        verify(txManager).commit(any());
    }

    @Test
    void deletingWithoutImageDoesNothing() {
        service.deleteProfileImage(USER_ID);

        verify(storage, never()).delete(anyString());
    }

    private static void assertCode(Runnable operation, ErrorCode expected) {
        assertThatThrownBy(operation::run)
                .isInstanceOfSatisfying(
                        ApiException.class, ex -> assertThat(ex.errorCode()).isEqualTo(expected));
    }
}
