package com.ssafy.a301.user.service;

import com.ssafy.a301.alarm.domain.PracticeAlarm;
import com.ssafy.a301.alarm.repository.PracticeAlarmRepository;
import com.ssafy.a301.auth.oauth.KakaoLoginClient;
import com.ssafy.a301.auth.oauth.SocialProfile;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.user.domain.SocialProvider;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.domain.UserSocialAccount;
import com.ssafy.a301.user.dto.UserDtos.MeResponse;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.repository.UserSocialAccountRepository;
import org.springframework.core.NestedExceptionUtils;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 소셜 계정 연결(2.12) · 해제(2.13). 이메일 회원이 카카오 계정을 연결하면 카카오 로그인(1.6)으로도 같은 회원에 들어가고 연습 알림(2.9)을 켤 수 있다.
 * 회원마다 연결은 하나뿐이라 소셜 회원과 이미 연결한 회원은 더 연결할 수 없다. 이메일이 달라도 연결한다(로그인한 본인이 카카오 로그인까지 했으므로).
 *
 * <p>카카오 호출은 트랜잭션 밖에서 하고, 저장은 회원 행을 잠그고 한다(겹친 연결 · 해제 · 탈퇴가 서로 덮어쓰지 않게).
 */
@Service
public class SocialAccountService {
    // 회원마다 연결 하나(V16)
    private static final String ONE_PER_USER_INDEX = "uk_user_social_accounts_user_active";
    private final KakaoLoginClient kakao;
    private final UserRepository users;
    private final UserSocialAccountRepository socialAccounts;
    private final PracticeAlarmRepository practiceAlarms;
    private final UserService userService;
    private final TransactionTemplate transactions;

    public SocialAccountService(
            KakaoLoginClient kakao,
            UserRepository users,
            UserSocialAccountRepository socialAccounts,
            PracticeAlarmRepository practiceAlarms,
            UserService userService,
            TransactionTemplate transactions) {
        this.kakao = kakao;
        this.users = users;
        this.socialAccounts = socialAccounts;
        this.practiceAlarms = practiceAlarms;
        this.userService = userService;
        this.transactions = transactions;
    }

    /** 2.12. 인가 코드는 한 번만 쓸 수 있어 카카오를 부르기 전에 연결할 수 있는 회원인지 먼저 본다 */
    public MeResponse link(long userId, String provider, String code, String redirectUri) {
        requireKakao(provider);
        // 잠그지 않고 읽는다. 저장할 때 잠그고 다시 확인한다
        requireLinkable(
                users.findByIdAndDeletedAtIsNull(userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED)));
        SocialProfile profile = fetchProfile(code, redirectUri);
        try {
            transactions.executeWithoutResult(
                    status -> {
                        User user = lockedUser(userId);
                        requireLinkable(user);
                        if (socialAccounts
                                .findActive(profile.provider(), profile.providerUserId())
                                .isPresent()) {
                            throw new ApiException(ErrorCode.SOCIAL_ACCOUNT_IN_USE);
                        }
                        socialAccounts.saveAndFlush(
                                new UserSocialAccount(
                                        user, profile.provider(), profile.providerUserId()));
                    });
        } catch (DataIntegrityViolationException ex) {
            throw new ApiException(conflictOf(ex));
        }
        return userService.me(userId);
    }

    /** 2.13. 연결하지 않았어도 성공으로 본다. 켜져 있던 연습 알림은 함께 끈다(시각은 남긴다) */
    public void unlink(long userId, String provider) {
        requireKakao(provider);
        transactions.executeWithoutResult(
                status -> {
                    User user = lockedUser(userId);
                    if (!user.hasPassword()) {
                        // 소셜 회원은 끊으면 로그인할 방법이 없다
                        throw new ApiException(ErrorCode.PASSWORD_NOT_SET);
                    }
                    socialAccounts
                            .findActiveByUserId(userId)
                            .filter(account -> account.getProvider() == SocialProvider.KAKAO)
                            .ifPresent(
                                    account -> {
                                        socialAccounts.delete(account);
                                        practiceAlarms
                                                .findForUpdate(userId)
                                                .ifPresent(PracticeAlarm::disable);
                                    });
                });
    }

    // 이번에는 카카오만 연결한다(구글 연결은 범위 밖)
    private static void requireKakao(String provider) {
        if (!SocialProvider.KAKAO.name().equalsIgnoreCase(provider)) {
            throw new FieldValidationException("provider", "지원하지 않는 연결 방법입니다.");
        }
    }

    // 소셜 회원은 가입한 계정이 이미 연결돼 있다
    private void requireLinkable(User user) {
        if (!user.hasPassword() || socialAccounts.findActiveProvider(user.getId()).isPresent()) {
            throw new ApiException(ErrorCode.SOCIAL_ALREADY_LINKED);
        }
    }

    // 로그인한 회원의 요청이라 쓸 수 없는 인가 코드를 401(로그인 만료로 오해)이 아닌 400으로 돌려준다
    private SocialProfile fetchProfile(String code, String redirectUri) {
        try {
            return kakao.fetchProfile(code, redirectUri);
        } catch (ApiException ex) {
            if (ex.errorCode() == ErrorCode.SOCIAL_LOGIN_FAILED) {
                throw new ApiException(ErrorCode.SOCIAL_LINK_FAILED);
            }
            throw ex;
        }
    }

    // 확인과 저장 사이에 먼저 커밋된 연결이 유일 인덱스에 걸렸다. 회원 행을 잠그므로 같은 회원 쪽(V16)은 다른 경로가 생겼을 때만 걸린다
    private static ErrorCode conflictOf(DataIntegrityViolationException ex) {
        String message = NestedExceptionUtils.getMostSpecificCause(ex).getMessage();
        return message != null && message.contains(ONE_PER_USER_INDEX)
                ? ErrorCode.SOCIAL_ALREADY_LINKED
                : ErrorCode.SOCIAL_ACCOUNT_IN_USE;
    }

    private User lockedUser(long userId) {
        return users.findActiveForUpdate(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
    }
}
