package com.ssafy.a301.auth.service;

import com.ssafy.a301.auth.dto.AgreementRequest;
import com.ssafy.a301.auth.dto.SocialLoginResponse;
import com.ssafy.a301.auth.dto.SocialLoginResponse.SocialSignup;
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
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.domain.UserSocialAccount;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.repository.UserSocialAccountRepository;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 소셜 로그인(1.6) · 소셜 회원가입(1.7). 제공자 회원 번호로 연결된 회원을 찾아 로그인하고, 처음 온 사람은 약관 동의 뒤 비밀번호 없는 회원으로 만든다. 같은
 * 이메일의 회원이 이미 있으면 계정을 합치지 않고 409로 막는다(남의 계정에 연결되지 않게).
 */
@Service
public class SocialAuthService {
    private static final Logger LOG = LoggerFactory.getLogger(SocialAuthService.class);
    // 제공자가 닉네임을 주지 않았을 때
    static final String DEFAULT_NICKNAME = "면접러";
    private static final int NICKNAME_MAX = 50;
    private final Map<SocialProvider, SocialLoginClient> clients =
            new EnumMap<>(SocialProvider.class);
    private final AuthService auth;
    private final UserRepository users;
    private final UserSocialAccountRepository socialAccounts;
    private final SocialSignupStore signups;
    private final OAuthProperties properties;
    private final TransactionTemplate transactions;

    public SocialAuthService(
            List<SocialLoginClient> clients,
            AuthService auth,
            UserRepository users,
            UserSocialAccountRepository socialAccounts,
            SocialSignupStore signups,
            OAuthProperties properties,
            TransactionTemplate transactions) {
        clients.forEach(client -> this.clients.put(client.provider(), client));
        this.auth = auth;
        this.users = users;
        this.socialAccounts = socialAccounts;
        this.signups = signups;
        this.properties = properties;
        this.transactions = transactions;
    }

    /** 1.6. provider는 경로 값(kakao · google) */
    public SocialLoginResponse login(String provider, String code, String redirectUri) {
        SocialProfile profile = client(provider).fetchProfile(code, redirectUri);
        Optional<User> linked = linkedUser(profile);
        if (linked.isPresent()) {
            return SocialLoginResponse.loggedIn(auth.tokens(linked.get()));
        }
        if (profile.email() == null) {
            throw new ApiException(ErrorCode.SOCIAL_EMAIL_REQUIRED);
        }
        if (!auth.isEmailAvailable(profile.email())) {
            throw new ApiException(ErrorCode.SOCIAL_EMAIL_DUPLICATED);
        }
        return SocialLoginResponse.signupRequired(
                new SocialSignup(
                        signups.issue(profile),
                        User.normalizeEmail(profile.email()),
                        nicknameOf(profile),
                        properties.signupTokenTtl().toSeconds()));
    }

    /**
     * 1.7. 가입 토큰은 가입에 성공한 뒤 지운다. 같은 토큰으로 겹쳐 보내거나 다른 가입 토큰으로 같은 소셜 계정이 먼저 가입했으면 회원을 새로 만들지 않고 그 회원으로
     * 로그인한다. 약관이 틀리거나 가입하지 못하면 가입 토큰은 그대로라 다시 보낼 수 있다
     */
    public TokenResponse signup(SocialSignupRequest request) {
        AuthService.requireAllTerms(request.agreements());
        SocialProfile profile = signups.find(request.signupToken());
        if (profile == null) {
            throw new ApiException(ErrorCode.SIGNUP_TOKEN_INVALID);
        }
        User user;
        try {
            user =
                    transactions.execute(
                            status ->
                                    linkedUser(profile)
                                            .orElseGet(
                                                    () -> create(profile, request.agreements())));
        } catch (DataIntegrityViolationException ex) {
            // 같은 소셜 계정 · 이메일의 가입이 먼저 커밋됐다
            user = linkedUser(profile).orElseThrow(() -> conflictOr(profile, ex));
        }
        deleteSignupToken(request.signupToken());
        // 리프레시 토큰은 회원이 커밋된 뒤에 만든다
        return auth.tokens(user);
    }

    // 가입 트랜잭션 안에서 부른다. 이메일 · 소셜 계정 중복이 겹치면 유일 제약이 막는다(saveAndFlush에서 바로 실패)
    private User create(SocialProfile profile, List<AgreementRequest> agreements) {
        if (!auth.isEmailAvailable(profile.email())) {
            throw new ApiException(ErrorCode.SOCIAL_EMAIL_DUPLICATED);
        }
        User saved = users.saveAndFlush(User.social(profile.email(), nicknameOf(profile)));
        auth.saveAgreements(saved, agreements);
        socialAccounts.saveAndFlush(
                new UserSocialAccount(saved, profile.provider(), profile.providerUserId()));
        return saved;
    }

    private RuntimeException conflictOr(SocialProfile profile, RuntimeException cause) {
        return auth.isEmailAvailable(profile.email())
                ? cause
                : new ApiException(ErrorCode.SOCIAL_EMAIL_DUPLICATED);
    }

    // 회원은 이미 만들어졌다. 지우지 못한 토큰은 다시 써도 같은 회원으로 로그인하고 유효 시간이 지나면 사라지므로 기록만 남긴다
    private void deleteSignupToken(String token) {
        try {
            signups.delete(token);
        } catch (DataAccessException ex) {
            LOG.warn("가입 토큰 삭제 실패: {}", ex.getMessage());
        }
    }

    private SocialLoginClient client(String provider) {
        return Arrays.stream(SocialProvider.values())
                .filter(candidate -> candidate.name().equalsIgnoreCase(provider))
                .findFirst()
                .map(clients::get)
                .orElseThrow(() -> new FieldValidationException("provider", "지원하지 않는 로그인 방법입니다."));
    }

    private Optional<User> linkedUser(SocialProfile profile) {
        return socialAccounts
                .findActive(profile.provider(), profile.providerUserId())
                .map(UserSocialAccount::getUser)
                .filter(user -> !user.isWithdrawn());
    }

    static String nicknameOf(SocialProfile profile) {
        String nickname = profile.nickname() == null ? "" : profile.nickname().strip();
        if (nickname.isEmpty()) {
            return DEFAULT_NICKNAME;
        }
        return nickname.codePointCount(0, nickname.length()) <= NICKNAME_MAX
                ? nickname
                : nickname.substring(0, nickname.offsetByCodePoints(0, NICKNAME_MAX));
    }
}
