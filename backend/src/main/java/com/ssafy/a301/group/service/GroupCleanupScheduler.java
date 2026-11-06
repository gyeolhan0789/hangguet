package com.ssafy.a301.group.service;

import java.time.OffsetDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** 멈춘 그룹 면접 정리(docs/그룹면접-설계.md 6.11 안전장치). 1분마다 확인한다 */
@Component
public class GroupCleanupScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(GroupCleanupScheduler.class);

    private final GroupEndService groupEnds;

    public GroupCleanupScheduler(GroupEndService groupEnds) {
        this.groupEnds = groupEnds;
    }

    @Scheduled(fixedDelayString = "${group.cleanup.interval:1m}")
    public void cleanupStalled() {
        try {
            int cleaned = groupEnds.cleanupStalled(OffsetDateTime.now());
            if (cleaned > 0) {
                LOG.info("멈춘 그룹 면접 {}건 정리", cleaned);
            }
        } catch (RuntimeException ex) {
            LOG.warn("멈춘 그룹 면접 정리 작업이 실패했다", ex);
        }
    }
}
