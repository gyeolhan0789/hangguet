package com.ssafy.a301.group.service;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.time.Duration;
import java.time.OffsetDateTime;
import org.springframework.stereotype.Component;

/** 그룹 면접 지표. 꼬리질문 판단 응답 시간으로 7초 제한을 2~3초로 줄일지 본다(docs/그룹면접-설계.md 6.4 응답 시간 측정) */
@Component
class GroupMetrics {
    static final String DECISION_TIMER = "a301.group.followup.decision";

    private final MeterRegistry meters;

    GroupMetrics(MeterRegistry meters) {
        this.meters = meters;
    }

    /**
     * @param outcome needed · not_needed · missing(제한 시간 안에 오지 않음). 판단 하나를 한 번만 센다. 늦게 온 판단은
     *     missing으로 이미 셌으므로 다시 세지 않는다
     * @param answeredAt 최종 답변을 저장한 시각(DECIDING 시작)
     */
    void followupDecision(String outcome, OffsetDateTime answeredAt, OffsetDateTime now) {
        Timer.builder(DECISION_TIMER)
                .tag("outcome", outcome)
                .publishPercentiles(0.5, 0.9, 0.99)
                .register(meters)
                .record(Duration.between(answeredAt, now));
    }
}
