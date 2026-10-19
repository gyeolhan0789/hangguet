package com.ssafy.a301.auth.service;

import com.ssafy.a301.auth.dto.LoginRequest;
import com.ssafy.a301.auth.dto.RefreshResponse;
import com.ssafy.a301.auth.dto.SignupRequest;
import com.ssafy.a301.auth.dto.TokenResponse;
import com.ssafy.a301.auth.jwt.AccessTokens;
import com.ssafy.a301.auth.jwt.AuthProperties;
import com.ssafy.a301.auth.repository.RefreshTokenStore;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.user.domain.TermsType;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.domain.UserAgreement;
import com.ssafy.a301.user.mapper.UserMapper;
import com.ssafy.a301.user.repository.UserAgreementRepository;
import com.ssafy.a301.user.repository.UserRepository;
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
    private final AuthProperties properties;
    private final TransactionTemplate transactions;

    public AuthService(
            UserRepository users,
            UserAgreementRepository agreements,
            PasswordEncoder passwords,
            AccessTokens accessTokens,
            RefreshTokenStore refreshTokens,
            AuthProperties properties,
            TransactionTemplate transactions) {
        this.users = users;
        this.agreements = agreements;
        this.passwords = passwords;
        this.accessTokens = accessTokens;
        this.refreshTokens = refreshTokens;
        this.properties = properties;
        this.transactions = transactions;
    }

    public boolean isEmailAvailable(String email) {
        return !users.existsByEmailAndDeletedAtIsNull(email);
    }

    public TokenResponse signup(SignupRequest request) {
        if (request.agreements().size() != 1
                || request.agreements().getFirst().termsType() != TermsType.TERMS) {
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
        User user =
                users.findByEmailAndDeletedAtIsNull(request.email())
                        .orElseThrow(() -> new ApiException(ErrorCode.LOGIN_FAILED));
        if (!passwords.matches(request.password(), user.getPasswordHash())) {
            throw new ApiException(ErrorCode.LOGIN_FAILED);
        }
        return tokens(user);
    }

    public RefreshResponse refresh(String token) {
        Long userId = refreshTokens.consume(token);
        if (userId == null) {
            throw new ApiException(ErrorCode.REFRESH_TOKEN_INVALID);
        }
        User user =
                users.findByIdAndDeletedAtIsNull(userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.REFRESH_TOKEN_INVALID));
        return new RefreshResponse(
                accessTokens.issue(userId, user.getNickname()),
                refreshTokens.issue(userId),
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
                UserMapper.toSummary(user, null));
    }
}
