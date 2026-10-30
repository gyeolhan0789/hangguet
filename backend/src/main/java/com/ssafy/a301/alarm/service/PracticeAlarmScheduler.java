package com.ssafy.a301.alarm.service;

import com.ssafy.a301.common.time.KoreaTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 카카오톡 연습 알림. 매분 그 시각을 고른 회원에게 보내고, 매일 4시 30분(한국 시간)에 곧 만료될 카카오 토큰을 갱신한다. 앞 작업이 길어지거나 서버가 잠깐 멈춰 건너뛴
 * 분은 10분 안이면 늦게라도 보낸다
 */
@Component
public class PracticeAlarmScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(PracticeAlarmScheduler.class);

    private final PracticeAlarmSender sender;

    public PracticeAlarmScheduler(PracticeAlarmSender sender) {
        this.sender = sender;
    }

    @Scheduled(cron = "0 * * * * *", zone = KoreaTime.ZONE_ID)
    public void sendDue() {
        try {
            int sent = sender.sendDue(KoreaTime.now());
            if (sent > 0) {
                LOG.info("연습 알림 {}건 보냄", sent);
            }
        } catch (RuntimeException ex) {
            LOG.warn("연습 알림 보내기 작업이 실패했다", ex);
        }
    }

    @Scheduled(cron = "0 30 4 * * *", zone = KoreaTime.ZONE_ID)
    public void renewTokens() {
        try {
            int renewed = sender.renewExpiringTokens(KoreaTime.now());
            if (renewed > 0) {
                LOG.info("연습 알림 카카오 토큰 {}건 갱신", renewed);
            }
        } catch (RuntimeException ex) {
            LOG.warn("연습 알림 카카오 토큰 갱신 작업이 실패했다", ex);
        }
    }
}
