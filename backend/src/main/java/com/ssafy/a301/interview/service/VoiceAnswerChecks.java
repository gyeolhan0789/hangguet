package com.ssafy.a301.interview.service;

import com.ssafy.a301.interview.domain.AnswerSpeech;
import com.ssafy.a301.interview.domain.AnswerToken;
import com.ssafy.a301.interview.domain.SttGap;
import java.util.List;
import java.util.stream.IntStream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 에이전트가 보낸 화상 답변(answer.completed, AI 명세 6.2)의 값 확인. 개인 면접(ai:results)과 그룹 면접(ai:results:group)이 같이
 * 쓴다.
 */
public final class VoiceAnswerChecks {
    private static final Logger LOG = LoggerFactory.getLogger(VoiceAnswerChecks.class);
    // 답변 글 길이(UTF-16)와 토큰 수 상한(AI 명세 6.2)
    private static final int MAX_ANSWER_LENGTH = 10_000;
    private static final int MAX_TOKEN_COUNT = 10_000;

    private VoiceAnswerChecks() {}

    /**
     * 답변 글과 토큰을 확인한다.
     *
     * @throws InvalidAiResultException 글이 비었거나 길거나, 토큰이 너무 많거나 시각이 맞지 않음
     */
    public static void requireValid(
            String content, List<AnswerToken> tokens, long sessionId, int seq) {
        if (content == null) {
            throw new InvalidAiResultException("필수 필드가 없다: content");
        }
        if (content.isBlank() || content.length() > MAX_ANSWER_LENGTH) {
            throw new InvalidAiResultException(
                    "답변 글은 1~10,000자다: session=" + sessionId + " seq=" + seq);
        }
        if (tokens != null
                && (tokens.size() > MAX_TOKEN_COUNT
                        || tokens.stream()
                                .anyMatch(t -> t.startMs() < 0 || t.startMs() > t.endMs()))) {
            throw new InvalidAiResultException(
                    "토큰은 10,000개 이하, 0 ≤ startMs ≤ endMs다: session=" + sessionId + " seq=" + seq);
        }
    }

    // 다시보기 타임라인용 값(AI 명세 3장 trailingOffAtMs·6.6 impressions)이 범위를 벗어나면 그 값만 버리고 답변은 저장한다.
    // 저장만 하고 채점·결과에 쓰지 않는 값이라 답변을 실패 목록으로 보낼 이유가 없다
    public static AnswerSpeech validTimeline(AnswerSpeech speech, long sessionId, int seq) {
        if (speech == null) {
            return null;
        }
        AnswerSpeech valid = speech.withValidTimeline();
        if (valid != speech) {
            LOG.warn("answer.completed 타임라인 값이 범위를 벗어나 버린다: session={} seq={}", sessionId, seq);
        }
        return valid;
    }

    // 끊긴 구간이 0 ≤ startMs ≤ endMs · 시각 순이 아니면 구간만 버린다. 답변은 저장하고 채점은 끊긴 구간 없이 한다(AI 명세 6.2)
    public static List<SttGap> validSttGaps(List<SttGap> gaps, long sessionId, int seq) {
        if (gaps == null) {
            return null;
        }
        boolean valid =
                gaps.size() <= MAX_TOKEN_COUNT
                        && gaps.stream()
                                .allMatch(
                                        g ->
                                                g != null
                                                        && g.startMs() >= 0
                                                        && g.startMs() <= g.endMs())
                        && IntStream.range(1, gaps.size())
                                .allMatch(i -> gaps.get(i - 1).startMs() <= gaps.get(i).startMs());
        if (!valid) {
            LOG.warn("answer.completed sttGaps 형식이 맞지 않아 버린다: session={} seq={}", sessionId, seq);
            return null;
        }
        return gaps.isEmpty() ? null : gaps;
    }
}
