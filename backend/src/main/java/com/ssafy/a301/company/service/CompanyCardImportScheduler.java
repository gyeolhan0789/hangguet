package com.ssafy.a301.company.service;

import com.ssafy.a301.common.time.KoreaTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 매시 정각(한국 시간)에 회사 카드 manifest를 확인한다. 파이프라인은 하루 한 번(13:00 시작) 올리므로 늦어도 한 시간 안에 들어온다. 배포 직후에도 기다리지
 * 않게 기동할 때 한 번 확인한다.
 */
@Component
public class CompanyCardImportScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(CompanyCardImportScheduler.class);

    private final CompanyCardImporter importer;

    public CompanyCardImportScheduler(CompanyCardImporter importer) {
        this.importer = importer;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        run();
    }

    @Scheduled(cron = "0 0 * * * *", zone = KoreaTime.ZONE_ID)
    public void run() {
        try {
            importer.importLatest();
        } catch (RuntimeException ex) {
            // manifest를 읽지 못함(권한·네트워크)·깨진 JSON. 다음 주기에 다시 한다
            LOG.warn("회사 카드를 적재하지 못했다", ex);
        }
    }
}
