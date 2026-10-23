package com.ssafy.a301.admin.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.BeanUtils;
import org.springframework.test.util.ReflectionTestUtils;

/** 유지권 사용(8.14)과 배포 지급 시점의 규칙. 시각은 고정 값으로 넘긴다. */
class StreakFreezeTest {
    private static final OffsetDateTime NOW = OffsetDateTime.parse("2026-10-23T15:00:00+09:00");

    @Test
    void availableFreezeBeforeExpiryBecomesUsed() {
        StreakFreeze freeze = freeze(StreakFreezeStatus.AVAILABLE, NOW.plusSeconds(1));

        freeze.use(NOW);

        assertThat(freeze.getStatus()).isEqualTo(StreakFreezeStatus.USED);
        assertThat(freeze.getUsedAt()).isEqualTo(NOW);
    }

    static Stream<StreakFreeze> unavailable() {
        return Stream.of(
                freeze(StreakFreezeStatus.USED, NOW.plusDays(1)),
                freeze(StreakFreezeStatus.EXPIRED, NOW.plusDays(1)),
                // 만료 시각이 지났는데 아직 EXPIRED로 바뀌지 않은 것
                freeze(StreakFreezeStatus.AVAILABLE, NOW));
    }

    @ParameterizedTest
    @MethodSource("unavailable")
    void usedOrExpiredFreezeIsNotAvailable(StreakFreeze freeze) {
        assertThatThrownBy(() -> freeze.use(NOW))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e ->
                                assertThat(e.errorCode())
                                        .isEqualTo(ErrorCode.STREAK_FREEZE_NOT_AVAILABLE));
    }

    @Test
    void grantIsDueFromGrantDateUntilGranted() {
        LocalDate today = LocalDate.of(2026, 10, 23);
        StreakFreezeGrant tomorrow =
                new StreakFreezeGrant(null, GrantTarget.ALL, 1, today.plusDays(1), today, null);
        StreakFreezeGrant todayGrant =
                new StreakFreezeGrant(null, GrantTarget.ALL, 1, today, today, null);

        assertThat(tomorrow.isDue(today)).isFalse();
        assertThat(todayGrant.isDue(today)).isTrue();
        assertThat(todayGrant.isDue(today.plusDays(1))).isTrue();

        todayGrant.markGranted(NOW);
        assertThat(todayGrant.isDue(today)).isFalse();
        assertThat(todayGrant.getStatus()).isEqualTo(GrantStatus.GRANTED);
    }

    // 유지권은 배포를 지급할 때 SQL로만 만들어 생성자가 없다
    private static StreakFreeze freeze(StreakFreezeStatus status, OffsetDateTime expiresAt) {
        StreakFreeze freeze = BeanUtils.instantiateClass(StreakFreeze.class);
        ReflectionTestUtils.setField(freeze, "status", status);
        ReflectionTestUtils.setField(freeze, "expiresAt", expiresAt);
        return freeze;
    }
}
