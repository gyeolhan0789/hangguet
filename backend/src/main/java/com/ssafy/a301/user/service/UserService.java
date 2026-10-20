package com.ssafy.a301.user.service;

import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.home.domain.Streak;
import com.ssafy.a301.home.repository.PracticeLogRepository;
import com.ssafy.a301.storage.domain.UploadPurpose;
import com.ssafy.a301.storage.repository.UploadKeyStore;
import com.ssafy.a301.storage.s3.PresignedUrl;
import com.ssafy.a301.storage.s3.S3FileStorage;
import com.ssafy.a301.storage.s3.S3Properties;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.dto.UserDtos.MeResponse;
import com.ssafy.a301.user.dto.UserDtos.NicknameChangeResponse;
import com.ssafy.a301.user.dto.UserDtos.UploadUrlResponse;
import com.ssafy.a301.user.mapper.UserMapper;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import software.amazon.awssdk.core.exception.SdkException;

/**
 * 2. 회원(탈퇴 2.7 제외). 회원은 토큰의 회원 id로만 찾는다.
 *
 * <p>변경은 users.save로 바로 저장한다. 프로필 사진의 이전 파일은 저장이 끝난 뒤 S3에서 지운다.
 */
@Service
public class UserService {
    private static final Logger LOG = LoggerFactory.getLogger(UserService.class);
    private static final ZoneId KOREA = ZoneId.of("Asia/Seoul");
    private static final Map<String, String> PROFILE_IMAGE_EXTENSIONS =
            Map.of("image/jpeg", "jpg", "image/png", "png");

    private final UserRepository users;
    private final PracticeLogRepository practiceLogs;
    private final PasswordEncoder passwords;
    private final AccessTokens accessTokens;
    private final AuthProperties authProperties;
    private final S3FileStorage storage;
    private final S3Properties storageProperties;
    private final UploadKeyStore uploadKeys;

    public UserService(
            UserRepository users,
            PracticeLogRepository practiceLogs,
            PasswordEncoder passwords,
            AccessTokens accessTokens,
            AuthProperties authProperties,
            S3FileStorage storage,
            S3Properties storageProperties,
            UploadKeyStore uploadKeys) {
        this.users = users;
        this.practiceLogs = practiceLogs;
        this.passwords = passwords;
        this.accessTokens = accessTokens;
        this.authProperties = authProperties;
        this.storage = storage;
        this.storageProperties = storageProperties;
        this.uploadKeys = uploadKeys;
    }

    public MeResponse me(long userId) {
        return toMe(activeUser(userId));
    }

    /** 토큰의 nickname 클레임이 바뀐 값이 되도록 새 액세스 토큰을 함께 준다. */
    public NicknameChangeResponse changeNickname(long userId, String nickname) {
        User user = activeUser(userId);
        user.changeNickname(nickname.strip());
        users.save(user);
        return UserMapper.toNicknameChange(
                user,
                profileImageUrl(user),
                currentStreak(userId),
                accessTokens.issue(userId, user.getNickname()),
                authProperties.accessTtl().toSeconds());
    }

    /** 다른 기기의 로그인(리프레시 토큰)은 유지한다. */
    public void changePassword(long userId, String currentPassword, String newPassword) {
        User user = activeUser(userId);
        if (!passwords.matches(currentPassword, user.getPasswordHash())) {
            throw new ApiException(ErrorCode.PASSWORD_MISMATCH);
        }
        user.changePasswordHash(passwords.encode(newPassword));
        users.save(user);
    }

    public UploadUrlResponse profileImageUploadUrl(long userId, String contentType, long size) {
        activeUser(userId);
        String objectKey =
                "profile/%d/%s.%s"
                        .formatted(
                                userId,
                                UUID.randomUUID(),
                                PROFILE_IMAGE_EXTENSIONS.get(contentType));
        PresignedUrl upload = storage.presignUpload(objectKey, contentType, size);
        uploadKeys.issue(
                objectKey, userId, UploadPurpose.PROFILE_IMAGE, storageProperties.uploadUrlTtl());
        return new UploadUrlResponse(upload.url(), objectKey, upload.expiresAt());
    }

    /** 본인에게 발급된 키이고 S3에 파일이 있을 때만 등록한다. 같은 키로 다시 불러도 결과는 같다. */
    public MeResponse registerProfileImage(long userId, String objectKey) {
        User user = activeUser(userId);
        if (!uploadKeys.isIssuedTo(objectKey, userId, UploadPurpose.PROFILE_IMAGE)) {
            throw new FieldValidationException("objectKey", "본인에게 발급된 키가 아닙니다.");
        }
        if (!storage.exists(objectKey)) {
            throw new ApiException(ErrorCode.FILE_NOT_FOUND);
        }
        String previousKey = user.getProfileImageKey();
        user.changeProfileImage(objectKey);
        users.save(user);
        if (previousKey != null && !previousKey.equals(objectKey)) {
            deleteFile(previousKey);
        }
        return toMe(user);
    }

    /** 이미 없어도 성공으로 본다. */
    public void deleteProfileImage(long userId) {
        User user = activeUser(userId);
        String key = user.getProfileImageKey();
        if (key == null) {
            return;
        }
        user.changeProfileImage(null);
        users.save(user);
        deleteFile(key);
    }

    // 토큰 검증에서 탈퇴 회원을 이미 거르지만, 검증 직후 탈퇴한 경우도 같은 401로 본다.
    private User activeUser(long userId) {
        return users.findByIdAndDeletedAtIsNull(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
    }

    private MeResponse toMe(User user) {
        return UserMapper.toMe(user, profileImageUrl(user), currentStreak(user.getId()));
    }

    private String profileImageUrl(User user) {
        String key = user.getProfileImageKey();
        return key == null ? null : storage.presignDownload(key);
    }

    private int currentStreak(long userId) {
        return Streak.current(practiceLogs.findPracticeDatesByUserId(userId), LocalDate.now(KOREA));
    }

    // 회원 정보는 이미 바뀌었으므로, 파일 삭제가 실패해도 요청은 성공으로 두고 남은 파일만 기록한다.
    private void deleteFile(String objectKey) {
        try {
            storage.delete(objectKey);
        } catch (SdkException ex) {
            LOG.warn("S3 파일 삭제 실패: {} ({})", objectKey, ex.getMessage());
        }
    }
}
