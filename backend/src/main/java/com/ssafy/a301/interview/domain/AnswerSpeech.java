package com.ssafy.a301.interview.domain;

import java.util.List;
import java.util.Objects;
import java.util.stream.Stream;

/**
 * 화상 답변에서 에이전트가 실시간 음성·사진으로 구한 값(answers.speech, AI 명세 3장 표·6.2·6.6). 구하지 못한 값은 null이다.
 *
 * <p>trailingOffAtMs·impressions는 다시보기 타임라인용이다. 채점에는 쓰지 않아 채점 작업에는 {@link #metrics()}만 보낸다.
 *
 * @param trailingOffRatio 말끝 흐림 비율(%)
 * @param pitchRangeSt 억양 폭(반음)
 * @param trailingOffAtMs 말끝 흐린 문장의 끝 시각(답변 시작 기준 밀리초, 시각 순)
 * @param impressions 답변 중 1초마다 판단한 인상
 */
public record AnswerSpeech(
        Double trailingOffRatio,
        Double pitchRangeSt,
        List<Integer> trailingOffAtMs,
        AnswerImpressions impressions) {
    // AI 명세 6.2: 흐린 문장 시각은 토큰 수 상한과 같다
    private static final int MAX_TRAILING_OFF_TIMES = 10_000;
    // AI 명세 6.6: 1초마다 1장이면 1시간
    private static final int MAX_IMPRESSIONS = 3_600;
    private static final int MAX_VERSION_LENGTH = 100;

    public AnswerSpeech(Double trailingOffRatio, Double pitchRangeSt) {
        this(trailingOffRatio, pitchRangeSt, null, null);
    }

    /** 채점 작업에 보내는 지표 2개(AI 명세 3장 작업 메시지의 speech) */
    public Metrics metrics() {
        return new Metrics(trailingOffRatio, pitchRangeSt);
    }

    /**
     * 범위를 벗어난 타임라인용 값을 null로 바꾼 사본. 답변 저장을 막지 않도록 버린다. 지표 2개와 답변은 그대로 저장한다.
     *
     * @return 바꾼 값이 없으면 자신
     */
    public AnswerSpeech withValidTimeline() {
        List<Integer> times = validTimes(trailingOffAtMs) ? trailingOffAtMs : null;
        AnswerImpressions judged = validImpressions(impressions) ? impressions : null;
        if (times == trailingOffAtMs && judged == impressions) {
            return this;
        }
        return new AnswerSpeech(trailingOffRatio, pitchRangeSt, times, judged);
    }

    private static boolean validTimes(List<Integer> times) {
        return times == null
                || (times.size() <= MAX_TRAILING_OFF_TIMES
                        && times.stream().allMatch(ms -> ms != null && ms >= 0));
    }

    private static boolean validImpressions(AnswerImpressions impressions) {
        if (impressions == null) {
            return true;
        }
        List<AnswerImpressions.Item> items = impressions.items();
        return validVersion(impressions.promptVersion())
                && validVersion(impressions.modelVersion())
                && items != null
                && items.size() <= MAX_IMPRESSIONS
                && items.stream().allMatch(AnswerSpeech::validItem);
    }

    private static boolean validVersion(String version) {
        return version != null && !version.isBlank() && version.length() <= MAX_VERSION_LENGTH;
    }

    private static boolean validItem(AnswerImpressions.Item item) {
        return item != null
                && item.atMs() != null
                && item.atMs() >= 0
                && item.face() != null
                && item.face() >= 0
                && item.face() <= 1
                && Stream.of(
                                item.stability(),
                                item.confidence(),
                                item.expression(),
                                item.emotion(),
                                item.likeability(),
                                item.trust())
                        .filter(Objects::nonNull)
                        .allMatch(score -> score >= 0 && score <= 100);
    }

    /**
     * 채점 작업 메시지의 speech(AI 명세 3장).
     *
     * @param trailingOffRatio 말끝 흐림 비율(%)
     * @param pitchRangeSt 억양 폭(반음)
     */
    public record Metrics(Double trailingOffRatio, Double pitchRangeSt) {}
}
