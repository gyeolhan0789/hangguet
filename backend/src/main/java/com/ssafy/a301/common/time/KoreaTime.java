package com.ssafy.a301.common.time;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;

/** 서비스 기준 시간대(한국 시간). 연습일·통계·성장 리뷰의 날짜 경계, 공지·유지권 기간, 스케줄러가 모두 이 시간대를 쓴다(API 명세 1장 "날짜는 한국 시간"). */
public final class KoreaTime {
    /** 스케줄러(@Scheduled zone)처럼 문자열이 필요한 곳에서 쓴다 */
    public static final String ZONE_ID = "Asia/Seoul";

    public static final ZoneId ZONE = ZoneId.of(ZONE_ID);

    private KoreaTime() {}

    public static OffsetDateTime now() {
        return OffsetDateTime.now(ZONE);
    }

    public static LocalDate today() {
        return LocalDate.now(ZONE);
    }

    /** 그날 0시(한국 시간). 하루 범위는 [startOfDay(d), startOfDay(d + 1)) */
    public static OffsetDateTime startOfDay(LocalDate date) {
        return date.atStartOfDay(ZONE).toOffsetDateTime();
    }

    /** 그 시각의 한국 날짜. 면접 시작일(연습일) 등 */
    public static LocalDate dateOf(OffsetDateTime time) {
        return time.atZoneSameInstant(ZONE).toLocalDate();
    }
}
