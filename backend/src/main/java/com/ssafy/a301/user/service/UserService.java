package com.ssafy.a301.user.service;

import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.auth.repository.RefreshTokenStore;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.practice.service.PracticeService;
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
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import software.amazon.awssdk.core.exception.SdkException;

/**
 * 2. 회원. 회원은 토큰의 회원 id로만 찾는다.
 *
 * <p>같은 회원의 요청이 겹쳐도 서로의 변경을 덮어쓰지 않도록, 변경은 회원 행을 잠그고 한다. 이전 사진 파일 삭제와 토큰 폐기는 커밋 뒤에 한다.
 */
@Service
public class UserService {
    private static final Logger LOG = LoggerFactory.getLogger(UserService.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    private static final Map<String, String> PROFILE_IMAGE_EXTENSIONS =
            Map.of("image/jpeg", "jpg", "image/png", "png");

    private final UserRepository users;
    private final PracticeService practices;
    private final PasswordEncoder passwords;
    private final AccessTokens accessTokens;
    private final AuthProperties authProperties;
    private final S3FileStorage storage;
    private final S3Properties storageProperties;
    private final UploadKeyStore uploadKeys;
    private final RefreshTokenStore refreshTokens;
    private final TransactionTemplate transactions;

    public UserService(
            UserRepository users,
            PracticeService practices,
            PasswordEncoder passwords,
            AccessTokens accessTokens,
            AuthProperties authProperties,
            S3FileStorage storage,
            S3Properties storageProperties,
            UploadKeyStore uploadKeys,
            RefreshTokenStore refreshTokens,
            TransactionTemplate transactions) {
        this.users = users;
        this.practices = practices;
        this.passwords = passwords;
        this.accessTokens = accessTokens;
        this.authProperties = authProperties;
        this.storage = storage;
        this.storageProperties = storageProperties;
        this.uploadKeys = uploadKeys;
        this.refreshTokens = refreshTokens;
        this.transactions = transactions;
    }

    public MeResponse me(long userId) {
        return toMe(activeUser(userId));
    }

    /** 토큰의 nickname 클레임이 바뀐 값이 되도록 새 액세스 토큰을 함께 준다. */
    public NicknameChangeResponse changeNickname(long userId, String nickname) {
        User user =
                transactions.execute(
                        status -> {
                            User locked = lockedUser(userId);
                            locked.changeNickname(nickname.strip());
                            return locked;
                        });
        return UserMapper.toNicknameChange(
                user,
                storage.presignDownload(user.getProfileImageKey()),
                currentStreak(userId),
                accessTokens.issue(userId, user.getNickname()),
                authProperties.accessTtl().toSeconds());
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
        activeUser(userId);
        if (!uploadKeys.isIssuedTo(objectKey, userId, UploadPurpose.PROFILE_IMAGE)) {
            throw new FieldValidationException("objectKey", "본인에게 발급된 키가 아닙니다.");
        }
        if (!storage.exists(objectKey)) {
            throw new ApiException(ErrorCode.FILE_NOT_FOUND);
        }
        ImageChange change =
                transactions.execute(
                        status -> {
                            User user = lockedUser(userId);
                            String previousKey = user.getProfileImageKey();
                            user.changeProfileImage(objectKey);
                            return new ImageChange(user, previousKey);
                        });
        if (change.previousKey() != null && !change.previousKey().equals(objectKey)) {
            deleteFile(change.previousKey());
        }
        return toMe(change.user());
    }

    /** 이미 없어도 성공으로 본다. */
    public void deleteProfileImage(long userId) {
        String key =
                transactions.execute(
                        status -> {
                            User user = lockedUser(userId);
                            String previous = user.getProfileImageKey();
                            user.changeProfileImage(null);
                            return previous;
                        });
        if (key != null) {
            deleteFile(key);
        }
    }

    /**
     * 탈퇴(2.7). 행은 남기고 deleted_at만 기록한 뒤 모든 기기의 리프레시 토큰을 폐기한다. 이후 로그인·재발급·API 호출은 탈퇴 회원을 조회하지 않아
     * 막힌다. soft delete라 개인정보·프로필 사진은 지우지 않는다(최종 파기 시점은 B-6).
     */
    public void withdraw(long userId, String password) {
        transactions.executeWithoutResult(
                status -> {
                    User user = lockedUser(userId);
                    if (!passwords.matches(password, user.getPasswordHash())) {
                        throw new ApiException(ErrorCode.PASSWORD_MISMATCH);
                    }
                    user.withdraw(OffsetDateTime.now(KST));
                });
        // 탈퇴는 이미 저장됐다. 남은 토큰은 재발급에서 탈퇴 회원으로 거절되므로 실패해도 기록만 남긴다.
        try {
            refreshTokens.revokeAll(userId);
        } catch (DataAccessException ex) {
            LOG.warn("탈퇴 회원 {}의 리프레시 토큰 폐기 실패: {}", userId, ex.getMessage());
        }
    }

    // 토큰 검증에서 탈퇴 회원을 이미 거르지만, 검증 직후 탈퇴한 경우도 같은 401로 본다.
    private User activeUser(long userId) {
        return users.findByIdAndDeletedAtIsNull(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
    }

    private record ImageChange(User user, String previousKey) {}

    // 변경은 행을 잠근 트랜잭션 안에서 하고 커밋 때 변경 감지로 저장한다. S3·Redis 작업은 커밋 뒤에 한다.
    private User lockedUser(long userId) {
        return users.findActiveForUpdate(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
    }

    private MeResponse toMe(User user) {
        return UserMapper.toMe(
                user,
                storage.presignDownload(user.getProfileImageKey()),
                currentStreak(user.getId()));
    }

    private int currentStreak(long userId) {
        return practices.currentStreak(userId);
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
