package com.ssafy.a301.auth.service;

import com.ssafy.a301.auth.dto.LoginRequest;
import com.ssafy.a301.auth.dto.RefreshResponse;
import com.ssafy.a301.auth.dto.SignupRequest;
import com.ssafy.a301.auth.dto.TokenResponse;
import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.auth.repository.RefreshTokenStore;
import com.ssafy.a301.auth.repository.RefreshTokenStore.RefreshSession;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.storage.s3.S3FileStorage;
import com.ssafy.a301.user.domain.TermsType;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.domain.UserAgreement;
import com.ssafy.a301.user.mapper.UserMapper;
import com.ssafy.a301.user.repository.PasswordChangeRepository;
import com.ssafy.a301.user.repository.UserAgreementRepository;
import com.ssafy.a301.user.repository.UserRepository;
import java.util.EnumSet;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AuthService {
    private final UserRepository users;
    private final UserAgreementRepository agreements;
    private final PasswordEncoder passwords;
    private final AccessTokens accessTokens;
    private final RefreshTokenStore refreshTokens;
    private final PasswordChangeRepository passwordChanges;
    private final AuthProperties properties;
    private final TransactionTemplate transactions;
    private final S3FileStorage storage;

    public AuthService(
            UserRepository users,
            UserAgreementRepository agreements,
            PasswordEncoder passwords,
            AccessTokens accessTokens,
            RefreshTokenStore refreshTokens,
            PasswordChangeRepository passwordChanges,
            AuthProperties properties,
            TransactionTemplate transactions,
            S3FileStorage storage) {
        this.users = users;
        this.agreements = agreements;
        this.passwords = passwords;
        this.accessTokens = accessTokens;
        this.refreshTokens = refreshTokens;
        this.passwordChanges = passwordChanges;
        this.properties = properties;
        this.transactions = transactions;
        this.storage = storage;
    }

    public boolean isEmailAvailable(String email) {
        return !users.existsActiveByEmail(User.normalizeEmail(email));
    }

    public TokenResponse signup(SignupRequest request) {
        var types = EnumSet.noneOf(TermsType.class);
        request.agreements().forEach(a -> types.add(a.termsType()));
        if (types.size() != TermsType.values().length) {
            throw new ApiException(ErrorCode.AGREEMENT_REQUIRED);
        }
        if (!isEmailAvailable(request.email())) {
            throw new ApiException(ErrorCode.EMAIL_DUPLICATED);
        }
        try {
            return transactions.execute(
                    status -> {
                        User saved =
                                users.saveAndFlush(
                                        new User(
                                                request.email(),
                                                passwords.encode(request.password()),
                                                request.nickname().strip()));
                        agreements.saveAll(
                                request.agreements().stream()
                                        .map(
                                                a ->
                                                        new UserAgreement(
                                                                saved,
                                                                a.termsType(),
                                                                a.termsVersion()))
                                        .toList());
                        return tokens(saved);
                    });
        } catch (DataIntegrityViolationException ex) {
            if (!isEmailAvailable(request.email())) {
                throw new ApiException(ErrorCode.EMAIL_DUPLICATED);
            }
            throw ex;
        }
    }

    public TokenResponse login(LoginRequest request) {
        // 대소문자만 다른 예전 계정이 둘 이상이면 비밀번호가 맞는 계정으로 로그인한다
        User user =
                users.findActiveByEmail(User.normalizeEmail(request.email())).stream()
                        .filter(
                                candidate ->
                                        passwords.matches(
                                                request.password(), candidate.getPasswordHash()))
                        .findFirst()
                        .orElseThrow(() -> new ApiException(ErrorCode.LOGIN_FAILED));
        return tokens(user);
    }

    /**
     * 토큰을 돌려 쓴다(쓴 토큰은 지움). 로그인한 뒤 관리자가 비밀번호를 바꿨으면 거절한다. 비밀번호 변경 때 토큰 폐기가 실패하거나 재발급과 겹쳐도 로그인 시각은
     * 재발급해도 이어지므로 다음 재발급에서 막힌다.
     */
    public RefreshResponse refresh(String token) {
        RefreshSession session = refreshTokens.consume(token);
        if (session == null) {
            throw new ApiException(ErrorCode.REFRESH_TOKEN_INVALID);
        }
        long userId = session.userId();
        User user =
                users.findByIdAndDeletedAtIsNull(userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.REFRESH_TOKEN_INVALID));
        boolean passwordChangedAfterLogin =
                passwordChanges
                        .findLatestChangedAt(userId)
                        .map(changedAt -> session.authenticatedAt().isBefore(changedAt.toInstant()))
                        .orElse(false);
        if (passwordChangedAfterLogin) {
            throw new ApiException(ErrorCode.REFRESH_TOKEN_INVALID);
        }
        return new RefreshResponse(
                accessTokens.issue(userId, user.getNickname()),
                refreshTokens.issue(userId, session.authenticatedAt()),
                properties.accessTtl().toSeconds());
    }

    public void logout(long userId, String token) {
        refreshTokens.revoke(token, userId);
    }

    private TokenResponse tokens(User user) {
        return new TokenResponse(
                accessTokens.issue(user.getId(), user.getNickname()),
                refreshTokens.issue(user.getId()),
                properties.accessTtl().toSeconds(),
                UserMapper.toSummary(user, storage.presignDownload(user.getProfileImageKey())));
    }
}
