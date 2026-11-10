package com.ssafy.a301.admin.service;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.LocalDate;
import java.time.ZoneId;
import org.junit.jupiter.api.Test;

/** 0시 작업은 한국 시간 전날을 남기고, 실패해도 스케줄러를 멈추지 않는다. 기동 때는 빠진 전날만 채운다. */
class AdminDailyMetricSchedulerTest {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final AdminDailyMetricService daily = mock(AdminDailyMetricService.class);
    private final AdminDailyMetricScheduler scheduler = new AdminDailyMetricScheduler(daily);

    @Test
    void midnightRunRecordsKoreanYesterday() {
        scheduler.run();

        verify(daily).recordDay(eq(LocalDate.now(KST).minusDays(1)), any());
    }

    @Test
    void startupFillsOnlyMissingYesterday() {
        when(daily.recordYesterdayIfAbsent(any())).thenReturn(false);

        scheduler.onReady();

        verify(daily).recordYesterdayIfAbsent(any());
    }

    @Test
    void failureIsLoggedNotThrown() {
        doThrow(new IllegalStateException("DB 끊김")).when(daily).recordDay(any(), any());
        when(daily.recordYesterdayIfAbsent(any())).thenThrow(new IllegalStateException("DB 끊김"));

        assertThatCode(scheduler::run).doesNotThrowAnyException();
        assertThatCode(scheduler::onReady).doesNotThrowAnyException();
    }
}
