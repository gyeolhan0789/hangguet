package com.ssafy.a301.admin.service;

import java.time.OffsetDateTime;
import java.time.ZoneId;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 매일 0시(한국 시간)에 전날 관리자 메트릭을 남긴다(8.16). 0시에 서버가 꺼져 있었으면 기동할 때 전날 기록이 없을 때만 남긴다. */
@Component
public class AdminDailyMetricScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(AdminDailyMetricScheduler.class);
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final AdminDailyMetricService daily;

    public AdminDailyMetricScheduler(AdminDailyMetricService daily) {
        this.daily = daily;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        try {
            if (daily.recordYesterdayIfAbsent(OffsetDateTime.now(KST))) {
                LOG.info("빠진 전날 관리자 메트릭을 기동 때 남겼다");
            }
        } catch (RuntimeException ex) {
            LOG.warn("전날 관리자 메트릭을 남기지 못했다", ex);
        }
    }

    @Scheduled(cron = "0 0 0 * * *", zone = "Asia/Seoul")
    public void run() {
        OffsetDateTime now = OffsetDateTime.now(KST);
        try {
            daily.record(now.toLocalDate().minusDays(1), now);
        } catch (RuntimeException ex) {
            LOG.warn("전날 관리자 메트릭을 남기지 못했다", ex);
        }
    }
}
