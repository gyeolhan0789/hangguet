package com.ssafy.a301.alarm.service;

import com.ssafy.a301.alarm.domain.PracticeAlarm;
import com.ssafy.a301.alarm.dto.PracticeAlarmDtos.PracticeAlarmResponse;
import com.ssafy.a301.alarm.kakao.KakaoApiException;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient.KakaoConsent;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient.KakaoToken;
import com.ssafy.a301.alarm.repository.PracticeAlarmRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.user.domain.SocialProvider;
import com.ssafy.a301.user.domain.UserSocialAccount;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.repository.UserSocialAccountRepository;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 카카오톡 연습 알림 설정(2.8 ~ 2.11). 카카오 계정이 연결된 회원(카카오 가입 · 이메일 회원의 연결 2.12)만 켤 수 있다. 켤 때 카카오
 * 동의(talk_message)로 받은 인가 코드를 토큰으로 바꿔 암호화해 저장하고, 끄면 토큰을 지운다. 알림 시각은 켜고 끄는 것과 따로 바꾸며 끈 뒤에도 남는다.
 *
 * <p>카카오 호출은 트랜잭션 밖에서 하고, 저장은 회원 행 · 알림 행을 잠그고 한다(탈퇴 · 토큰 갱신과 겹쳐도 덮어쓰지 않게).
 */
@Service
public class PracticeAlarmService {
    private static final Logger LOG = LoggerFactory.getLogger(PracticeAlarmService.class);
    private static final DateTimeFormatter TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm");

    private final PracticeAlarmRepository alarms;
    private final UserRepository users;
    private final UserSocialAccountRepository socialAccounts;
    private final KakaoMessageClient kakao;
    private final TransactionTemplate transactions;

    public PracticeAlarmService(
            PracticeAlarmRepository alarms,
            UserRepository users,
            UserSocialAccountRepository socialAccounts,
            KakaoMessageClient kakao,
            TransactionTemplate transactions) {
        this.alarms = alarms;
        this.users = users;
        this.socialAccounts = socialAccounts;
        this.kakao = kakao;
        this.transactions = transactions;
    }

    /** 2.8 */
    public PracticeAlarmResponse get(long userId) {
        boolean available = kakaoAccountOf(userId).isPresent();
        return alarms.findById(userId)
                .map(alarm -> toResponse(available, alarm))
                .orElseGet(
                        () ->
                                new PracticeAlarmResponse(
                                        available, false, format(PracticeAlarm.DEFAULT_TIME)));
    }

    /** 2.9 켜기. 연결된 카카오 계정과 같은 계정이고 메시지 전송에 동의했을 때만 토큰을 저장한다. 이미 켜져 있으면 새 토큰으로 바꾼다(다시 동의한 경우) */
    public PracticeAlarmResponse enable(long userId, String code, String redirectUri) {
        UserSocialAccount account =
                kakaoAccountOf(userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.PRACTICE_ALARM_UNAVAILABLE));
        if (!kakao.isConfigured()) {
            LOG.warn("카카오 키(KAKAO_CLIENT_ID)가 없어 연습 알림을 켤 수 없음");
            throw new ApiException(ErrorCode.KAKAO_UNAVAILABLE);
        }
        if (!kakao.isAllowedRedirectUri(redirectUri)) {
            throw new FieldValidationException("redirectUri", "등록되지 않은 주소입니다.");
        }
        OffsetDateTime now = KoreaTime.now();
        KakaoToken token;
        KakaoConsent consent;
        try {
            token = kakao.exchange(code, redirectUri);
            consent = kakao.consent(token.accessToken());
        } catch (KakaoApiException ex) {
            throw toApiException(ex);
        }
        if (!consent.kakaoUserId().equals(account.getProviderUserId())) {
            throw new ApiException(ErrorCode.KAKAO_ACCOUNT_MISMATCH);
        }
        if (!consent.messageAgreed()) {
            throw new ApiException(ErrorCode.KAKAO_MESSAGE_CONSENT_REQUIRED);
        }
        if (token.refreshToken() == null || token.refreshTokenExpiresIn() == null) {
            LOG.warn("카카오가 인가 코드로 리프레시 토큰을 주지 않음");
            throw new ApiException(ErrorCode.KAKAO_UNAVAILABLE);
        }
        PracticeAlarm alarm =
                transactions.execute(
                        status -> {
                            PracticeAlarm locked = lockedAlarm(userId);
                            // 카카오를 부르는 사이 연결을 끊었으면(2.13) 켜지 않는다
                            if (!kakaoAccountOf(userId)
                                    .map(UserSocialAccount::getProviderUserId)
                                    .equals(Optional.of(account.getProviderUserId()))) {
                                throw new ApiException(ErrorCode.PRACTICE_ALARM_UNAVAILABLE);
                            }
                            locked.enable(
                                    token.accessToken(),
                                    now.plusSeconds(token.expiresIn()),
                                    token.refreshToken(),
                                    now.plusSeconds(token.refreshTokenExpiresIn()));
                            return locked;
                        });
        return toResponse(true, alarm);
    }

    /** 2.10 시각 변경. 켜져 있지 않아도 저장해 두고 켤 때 쓴다 */
    public PracticeAlarmResponse changeTime(long userId, LocalTime time) {
        if (kakaoAccountOf(userId).isEmpty()) {
            throw new ApiException(ErrorCode.PRACTICE_ALARM_UNAVAILABLE);
        }
        PracticeAlarm alarm =
                transactions.execute(
                        status -> {
                            PracticeAlarm locked = lockedAlarm(userId);
                            locked.changeTime(time);
                            return locked;
                        });
        return toResponse(true, alarm);
    }

    /** 2.11 끄기. 토큰을 지운다. 이미 꺼져 있거나 카카오 계정을 연결하지 않았어도 성공으로 본다 */
    public void disable(long userId) {
        transactions.executeWithoutResult(
                status -> alarms.findForUpdate(userId).ifPresent(PracticeAlarm::disable));
    }

    static String format(LocalTime time) {
        return time.format(TIME_FORMAT);
    }

    private static PracticeAlarmResponse toResponse(boolean available, PracticeAlarm alarm) {
        return new PracticeAlarmResponse(
                available, alarm.isEnabled(), format(alarm.getAlarmTime()));
    }

    private Optional<UserSocialAccount> kakaoAccountOf(long userId) {
        return socialAccounts
                .findActiveByUserId(userId)
                .filter(account -> account.getProvider() == SocialProvider.KAKAO);
    }

    // 트랜잭션 안에서 부른다. 회원 행을 먼저 잠가 탈퇴(알림 행 삭제)와 겹치지 않게 한다
    private PracticeAlarm lockedAlarm(long userId) {
        users.findActiveForUpdate(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        alarms.insertIfAbsent(userId, PracticeAlarm.DEFAULT_TIME);
        return alarms.findForUpdate(userId).orElseThrow();
    }

    private static ApiException toApiException(KakaoApiException ex) {
        if (ex.kind() == KakaoApiException.Kind.UNAVAILABLE) {
            LOG.warn("연습 알림 켜기 중 카카오 호출 실패: {}", ex.getMessage());
            return new ApiException(ErrorCode.KAKAO_UNAVAILABLE);
        }
        LOG.info("연습 알림 켜기 거절: {}", ex.getMessage());
        return new ApiException(ErrorCode.KAKAO_CONSENT_FAILED);
    }
}
