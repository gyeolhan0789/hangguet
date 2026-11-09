package com.ssafy.a301.result.mapper;

import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.result.dto.ResultDtos.ReplayTimeline;
import com.ssafy.a301.result.dto.ResultDtos.TimelineCheckpoint;
import com.ssafy.a301.result.dto.ResultDtos.TimelinePoint;
import com.ssafy.a301.result.dto.ResultDtos.TimelineReason;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

/**
 * 결과 생성이 answers.evaluation.timeline에 남긴 다시보기 타임라인(AI 명세 4장)을 6.4 응답으로 바꾼다. 답변 기준 밀리초를 영상 위치(초)로
 * 옮긴다. 영상 위치는 질문 마커와 같이 합친 영상의 0초 시각(recordingStartedAt, 없으면 면접 시작 일시)이 0초다(API 명세 6.4).
 *
 * <p>저장만 하고 채점에 쓰지 않는 부가 값이라, 형식이 틀리면 그 답변의 타임라인만 null로 둔다.
 */
final class ReplayTimelines {
    private static final Logger LOG = LoggerFactory.getLogger(ReplayTimelines.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Set<String> METRICS =
            Set.of(
                    "STABILITY",
                    "CONFIDENCE",
                    "EXPRESSION",
                    "EMOTION",
                    "LIKEABILITY",
                    "TRUST",
                    "TRAILING_OFF",
                    "FILLER",
                    "LONG_PAUSE");
    // AI 명세 4장: 보완할 점은 100자 이하
    private static final int MAX_TEXT_LENGTH = 100;

    private ReplayTimelines() {}

    /** 형식이 틀렸거나 시각을 알 수 없으면 null */
    static ReplayTimeline of(Answer answer, OffsetDateTime videoZero) {
        return of(answer, videoZero, Double.NEGATIVE_INFINITY, Double.POSITIVE_INFINITY);
    }

    /**
     * 그룹 화상 면접(docs/그룹면접-설계.md 6.12). 이어 붙인 영상에서 그 답변의 구간 [from, to] 밖의 점 · 체크포인트는 빼고, 체크포인트 구간은 구간
     * 안으로 줄인다.
     *
     * @param videoZero 그 구간이 이어 붙인 영상에서 0초였다면의 시각(구간 시작 시각 − 구간의 영상 위치)
     */
    static ReplayTimeline of(Answer answer, OffsetDateTime videoZero, double from, double to) {
        Map<String, Object> evaluation = answer.getEvaluation();
        Object raw = evaluation == null ? null : evaluation.get("timeline");
        if (raw == null || videoZero == null || answer.getStartedAt() == null) {
            return null;
        }
        try {
            AiTimeline timeline = JSON.convertValue(raw, AiTimeline.class);
            long offsetMs = Duration.between(videoZero, answer.getStartedAt()).toMillis();
            return new ReplayTimeline(
                    present(timeline.points()).stream()
                            .map(
                                    p ->
                                            new TimelinePoint(
                                                    seconds(offsetMs, present(p).atMs()),
                                                    finite(p.value())))
                            .filter(p -> p.at() >= from && p.at() <= to)
                            .toList(),
                    present(timeline.checkpoints()).stream()
                            .map(c -> checkpoint(present(c), offsetMs))
                            .filter(c -> c.at() >= from && c.at() <= to)
                            .map(
                                    c ->
                                            new TimelineCheckpoint(
                                                    c.at(),
                                                    Math.max(c.start(), from),
                                                    Math.min(c.end(), to),
                                                    c.value(),
                                                    c.reasons()))
                            .toList());
        } catch (JacksonException | IllegalArgumentException ex) {
            LOG.warn("다시보기 타임라인 형식이 틀려 빼고 응답한다: answer={} {}", answer.getId(), ex.getMessage());
            return null;
        }
    }

    private static TimelineCheckpoint checkpoint(AiCheckpoint c, long offsetMs) {
        return new TimelineCheckpoint(
                seconds(offsetMs, c.atMs()),
                seconds(offsetMs, c.startMs()),
                seconds(offsetMs, c.endMs()),
                finite(c.value()),
                present(c.reasons()).stream().map(r -> reason(present(r))).toList());
    }

    private static <T> T present(T value) {
        if (value == null) {
            throw new IllegalArgumentException("값이 없다");
        }
        return value;
    }

    private static TimelineReason reason(AiReason r) {
        if (!METRICS.contains(r.metric())) {
            throw new IllegalArgumentException("모르는 metric: " + r.metric());
        }
        if (r.text() == null || r.text().isBlank() || r.text().length() > MAX_TEXT_LENGTH) {
            throw new IllegalArgumentException("보완할 점이 없거나 길다");
        }
        if (r.count() != null && r.count() < 0) {
            throw new IllegalArgumentException("count가 음수다");
        }
        return new TimelineReason(r.metric(), r.count(), r.text());
    }

    // 영상 위치(초, 소수 셋째 자리)
    private static double seconds(long offsetMs, Long atMs) {
        if (atMs == null || atMs < 0) {
            throw new IllegalArgumentException("시각이 없거나 음수다");
        }
        return (offsetMs + atMs) / 1000.0;
    }

    private static double finite(Double value) {
        if (value == null || !Double.isFinite(value)) {
            throw new IllegalArgumentException("value가 유한한 수가 아니다");
        }
        return value;
    }

    // AI 명세 4장 answers[].evaluation.timeline 형식(답변 기준 밀리초)
    record AiTimeline(List<AiPoint> points, List<AiCheckpoint> checkpoints) {}

    record AiPoint(Long atMs, Double value) {}

    record AiCheckpoint(
            Long atMs, Long startMs, Long endMs, Double value, List<AiReason> reasons) {}

    record AiReason(String metric, Integer count, String text) {}
}
