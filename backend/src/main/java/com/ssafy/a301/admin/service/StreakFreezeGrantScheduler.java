package com.ssafy.a301.admin.service;

import com.ssafy.a301.common.time.KoreaTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 매일 0시(한국 시간)에 지급 날짜가 된 유지권 배포를 지급하고 기간이 지난 유지권을 만료로 바꾼다. 0시에 서버가 꺼져 있었으면 기동할 때 한다. */
@Component
public class StreakFreezeGrantScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(StreakFreezeGrantScheduler.class);

    private final StreakFreezeGrantService grants;

    public StreakFreezeGrantScheduler(StreakFreezeGrantService grants) {
        this.grants = grants;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        run();
    }

    @Scheduled(cron = "0 0 0 * * *", zone = KoreaTime.ZONE_ID)
    public void run() {
        try {
            int granted = grants.grantDue();
            int expired = grants.expireFreezes();
            if (granted > 0 || expired > 0) {
                LOG.info("유지권 배포 {}건 지급, 유지권 {}개 만료", granted, expired);
            }
        } catch (RuntimeException ex) {
            LOG.warn("유지권 지급·만료 작업이 실패했다", ex);
        }
    }
}
