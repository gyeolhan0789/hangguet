package com.ssafy.a301.group.service;

import com.ssafy.a301.common.time.KoreaTime;
import java.time.OffsetDateTime;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 그룹 면접 주기 작업(docs/그룹면접-설계.md 6.9 · 6.11). 마감 처리기는 1초마다, 면접방 참가자 맞추기는 15초마다, 멈춘 그룹 정리(안전장치)는 1분마다
 * 돈다. 마감 처리기가 단계마다 기한을 처리하므로 안전장치는 그래도 멈춘 그룹만 잡는다.
 */
@Component
public class GroupDeadlineScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(GroupDeadlineScheduler.class);

    private final GroupDeadlineService deadlines;
    private final GroupAbsenceService absences;
    private final GroupEndService groupEnds;

    public GroupDeadlineScheduler(
            GroupDeadlineService deadlines,
            GroupAbsenceService absences,
            GroupEndService groupEnds) {
        this.deadlines = deadlines;
        this.absences = absences;
        this.groupEnds = groupEnds;
    }

    @Scheduled(
            fixedDelayString = "${group.deadline.interval:1s}",
            initialDelayString = "${group.deadline.interval:1s}")
    public void processDeadlines() {
        try {
            deadlines.tick(OffsetDateTime.now(KoreaTime.ZONE));
        } catch (RuntimeException ex) {
            LOG.warn("그룹 면접 마감 처리가 실패했다", ex);
        }
    }

    @Scheduled(
            fixedDelayString = "${group.presence-check.interval:15s}",
            initialDelayString = "${group.presence-check.interval:15s}")
    public void checkPresence() {
        try {
            absences.reconcile(OffsetDateTime.now(KoreaTime.ZONE));
        } catch (RuntimeException ex) {
            LOG.warn("그룹 면접방 참가자 맞추기가 실패했다", ex);
        }
    }

    @Scheduled(
            fixedDelayString = "${group.cleanup.interval:1m}",
            initialDelayString = "${group.cleanup.interval:1m}")
    public void cleanupStalled() {
        try {
            int cleaned = groupEnds.cleanupStalled(OffsetDateTime.now(KoreaTime.ZONE));
            if (cleaned > 0) {
                LOG.info("멈춘 그룹 면접 {}건 정리", cleaned);
            }
        } catch (RuntimeException ex) {
            LOG.warn("멈춘 그룹 면접 정리 작업이 실패했다", ex);
        }
    }
}
