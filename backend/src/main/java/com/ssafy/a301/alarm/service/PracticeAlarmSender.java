package com.ssafy.a301.alarm.service;

import com.ssafy.a301.alarm.domain.PracticeAlarm;
import com.ssafy.a301.alarm.kakao.KakaoApiException;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient;
import com.ssafy.a301.alarm.kakao.KakaoMessageClient.KakaoToken;
import com.ssafy.a301.alarm.repository.PracticeAlarmRepository;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.practice.service.PracticeService;
import java.time.Duration;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 카카오톡 연습 알림 보내기. 매분 그 시각을 고른 회원 중 오늘 연습하지 않은 회원에게 "나에게 보내기"로 알린다(PracticeAlarmScheduler).
 *
 * <ul>
 *   <li>지난 10분 안의 시각도 함께 찾는다. 앞 작업이 길어졌거나 서버가 잠깐 멈춰 건너뛴 분의 알림을 늦게라도 보낸다. 그보다 오래된 알림은 보내지 않는다
 *   <li>하루 한 번: 보내기 전에 오늘 보낼 차례를 가져간다(last_sent_on). 실패해도 그날은 다시 보내지 않는다
 *   <li>액세스 토큰이 만료됐으면 리프레시 토큰으로 새로 받아 저장하고 보낸다
 *   <li>리프레시 토큰이 거절되거나 회원이 동의를 철회했으면 알림을 끈다(다시 켜려면 다시 동의)
 *   <li>한 회원이 실패해도 다른 회원에게는 계속 보낸다
 * </ul>
 */
@Service
public class PracticeAlarmSender {
    private static final Logger LOG = LoggerFactory.getLogger(PracticeAlarmSender.class);
    // 만료 직전 토큰으로 보내다 실패하지 않게 이만큼 남았으면 미리 갱신한다
    static final Duration ACCESS_TOKEN_MARGIN = Duration.ofMinutes(1);
    // 카카오는 리프레시 토큰이 1개월 미만으로 남았을 때 갱신하면 새로 준다. 매일 연습해 알림을 받지 않는 회원도 끊기지 않게 미리 갱신한다
    static final Duration REFRESH_TOKEN_RENEW_BEFORE = Duration.ofDays(28);
    // 건너뛴 분을 늦게라도 보내는 범위
    static final int CATCH_UP_MINUTES = 10;

    private final PracticeAlarmRepository alarms;
    private final PracticeService practices;
    private final KakaoMessageClient kakao;
    private final TransactionTemplate transactions;

    public PracticeAlarmSender(
            PracticeAlarmRepository alarms,
            PracticeService practices,
            KakaoMessageClient kakao,
            TransactionTemplate transactions) {
        this.alarms = alarms;
        this.practices = practices;
        this.kakao = kakao;
        this.transactions = transactions;
    }

    /** 알림 시각이 now(분)와 그 앞 10분 사이인 회원에게 보낸다. 자정을 넘겨 어제 시각까지 거슬러 가지 않는다. 보낸 수 */
    public int sendDue(OffsetDateTime now) {
        ZonedDateTime korea = now.atZoneSameInstant(KoreaTime.ZONE);
        LocalDate today = korea.toLocalDate();
        LocalTime to = korea.toLocalTime().truncatedTo(ChronoUnit.MINUTES);
        LocalTime from = to.minusMinutes(CATCH_UP_MINUTES);
        if (from.isAfter(to)) {
            from = LocalTime.MIDNIGHT;
        }
        int sent = 0;
        for (long userId : alarms.findDueUserIds(from, to, today)) {
            if (sendTo(userId, today, now)) {
                sent++;
            }
        }
        return sent;
    }

    /** 리프레시 토큰이 곧 만료될 알림의 토큰을 갱신한다. 갱신한 수 */
    public int renewExpiringTokens(OffsetDateTime now) {
        int renewed = 0;
        for (long userId : alarms.findRefreshDueUserIds(now.plus(REFRESH_TOKEN_RENEW_BEFORE))) {
            PracticeAlarm alarm =
                    alarms.findById(userId).filter(PracticeAlarm::isEnabled).orElse(null);
            if (alarm == null) {
                continue;
            }
            try {
                renew(alarm, now);
                renewed++;
            } catch (KakaoApiException ex) {
                handleFailure(alarm, ex);
            } catch (RuntimeException ex) {
                LOG.warn("회원 {}의 카카오 토큰 갱신 실패", userId, ex);
            }
        }
        return renewed;
    }

    static String message(int currentStreak) {
        if (currentStreak > 0) {
            return "[한끗] 오늘 연습하면 %d일 연속이에요! 🔥\n스트릭이 끊기기 전에 면접 연습을 해 보세요."
                    .formatted(currentStreak + 1);
        }
        return "[한끗] 오늘의 면접 연습, 아직 안 하셨어요!\n짧게라도 한 번 연습해 볼까요? 💪";
    }

    private boolean sendTo(long userId, LocalDate today, OffsetDateTime now) {
        PracticeAlarm alarm = null;
        try {
            Integer claimed = transactions.execute(status -> alarms.claimToday(userId, today));
            if (claimed == 0) {
                return false;
            }
            alarm = alarms.findById(userId).filter(PracticeAlarm::isEnabled).orElse(null);
            if (alarm == null) {
                return false;
            }
            // 알림 시각 전에는 연습하지 않았으므로 스트릭은 어제까지 이어진 날 수다
            String text = message(practices.currentStreak(userId));
            boolean fresh = alarm.getKakaoAccessExpiresAt().isAfter(now.plus(ACCESS_TOKEN_MARGIN));
            String accessToken = fresh ? alarm.getKakaoAccessToken() : renew(alarm, now);
            send(alarm, accessToken, fresh, text, now);
            return true;
        } catch (KakaoApiException ex) {
            if (alarm != null) {
                handleFailure(alarm, ex);
            }
            return false;
        } catch (RuntimeException ex) {
            LOG.warn("회원 {}에게 연습 알림을 보내지 못했다", userId, ex);
            return false;
        }
    }

    // 만료 시각 전에 무효가 된 토큰(카카오 쪽 로그아웃 등)은 한 번만 새로 받아 다시 보낸다
    private void send(
            PracticeAlarm alarm,
            String accessToken,
            boolean fresh,
            String text,
            OffsetDateTime now) {
        try {
            kakao.sendToMe(accessToken, text);
        } catch (KakaoApiException ex) {
            if (ex.kind() != KakaoApiException.Kind.TOKEN_EXPIRED || !fresh) {
                throw ex;
            }
            kakao.sendToMe(renew(alarm, now), text);
        }
    }

    // 새 토큰을 저장하고 액세스 토큰을 돌려준다. 그 사이 회원이 껐으면 저장하지 않는다
    private String renew(PracticeAlarm alarm, OffsetDateTime now) {
        KakaoToken token = kakao.refresh(alarm.getKakaoRefreshToken());
        OffsetDateTime refreshExpiresAt =
                token.refreshTokenExpiresIn() == null
                        ? null
                        : now.plusSeconds(token.refreshTokenExpiresIn());
        transactions.executeWithoutResult(
                status ->
                        alarms.findForUpdate(alarm.getUserId())
                                .filter(PracticeAlarm::isEnabled)
                                .ifPresent(
                                        locked ->
                                                locked.renewTokens(
                                                        token.accessToken(),
                                                        now.plusSeconds(token.expiresIn()),
                                                        token.refreshToken(),
                                                        refreshExpiresAt)));
        // 이후 실패 처리(handleFailure)가 새 리프레시 토큰과 비교하도록 읽어 둔 값도 바꾼다
        alarm.renewTokens(
                token.accessToken(),
                now.plusSeconds(token.expiresIn()),
                token.refreshToken(),
                refreshExpiresAt);
        return token.accessToken();
    }

    // 다시 동의해야 하는 실패면 알림을 끈다. 그 사이 회원이 다시 켜서 토큰이 바뀌었으면 두고, 그 밖의 실패는 기록만 한다
    private void handleFailure(PracticeAlarm alarm, KakaoApiException ex) {
        if (ex.kind() != KakaoApiException.Kind.REJECTED) {
            LOG.warn("회원 {}의 연습 알림 실패: {}", alarm.getUserId(), ex.getMessage());
            return;
        }
        String usedRefreshToken = alarm.getKakaoRefreshToken();
        transactions.executeWithoutResult(
                status ->
                        alarms.findForUpdate(alarm.getUserId())
                                .filter(
                                        locked ->
                                                usedRefreshToken.equals(
                                                        locked.getKakaoRefreshToken()))
                                .ifPresent(PracticeAlarm::disable));
        LOG.info("회원 {}의 카카오 동의가 끝나 연습 알림을 껐다: {}", alarm.getUserId(), ex.getMessage());
    }
}
