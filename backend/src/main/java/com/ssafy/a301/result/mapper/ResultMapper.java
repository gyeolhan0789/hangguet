package com.ssafy.a301.result.mapper;

import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.EndReason;
import com.ssafy.a301.interview.domain.Grade;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.RecordingSegment;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.result.dto.ResultDtos;
import com.ssafy.a301.result.dto.ResultDtos.AnswerFeedback;
import com.ssafy.a301.result.dto.ResultDtos.ReplayItem;
import com.ssafy.a301.result.dto.ResultDtos.ReplayResponse;
import com.ssafy.a301.result.dto.ResultDtos.ReplaySegment;
import com.ssafy.a301.result.dto.ResultDtos.ReplayTimeline;
import com.ssafy.a301.result.dto.ResultDtos.ResultResponse;
import com.ssafy.a301.result.dto.ResultDtos.SpeechMetrics;
import com.ssafy.a301.result.dto.ResultDtos.VideoStatus;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 엔티티 → 결과·다시보기 응답. 3단계(grade)는 점수로 계산한다(경계 API 명세 6.3). */
public final class ResultMapper {

    private ResultMapper() {}

    /** 질문과 그 답변. 답변하지 않은 질문이면 answer가 null */
    public record QuestionAndAnswer(InterviewQuestion question, Answer answer) {}

    // 6.3. 결과에는 답변한 질문만 넣는다(점수가 있는 것)
    public static ResultResponse toResult(
            InterviewSession session,
            List<SessionScore> scores,
            List<QuestionAndAnswer> items,
            SpeechMetric metric) {
        List<ResultDtos.SessionScore> sessionScores =
                scores.stream()
                        .map(
                                s ->
                                        new ResultDtos.SessionScore(
                                                s.getCriterion(),
                                                s.getScore(),
                                                Grade.of(s.getScore()),
                                                s.getComment()))
                        .toList();
        List<AnswerFeedback> answers =
                items.stream()
                        .filter(i -> i.answer() != null && i.answer().getScore() != null)
                        .sorted(Comparator.comparingInt(i -> i.question().getSeq()))
                        .map(
                                i ->
                                        new AnswerFeedback(
                                                i.question().getId(),
                                                i.question().getSeq(),
                                                i.question().getContent(),
                                                i.answer().getContent(),
                                                i.answer().getScore(),
                                                Grade.of(i.answer().getScore()),
                                                i.answer().getGoodPoint(),
                                                i.answer().getImprovePoint()))
                        .toList();
        return new ResultResponse(
                session.getId(),
                session.getPersona(),
                session.getMode(),
                session.getApplication().getCompanyName(),
                session.getApplication().getJobTitle(),
                session.getHeadline(),
                session.getStartedAt(),
                session.getEndedAt(),
                sessionScores,
                answers,
                session.isVideo() ? toSpeechMetrics(metric) : null,
                session.getEndReason() == EndReason.AI_FAILURE);
    }

    // 6.4. 낸 질문은 답변이 없어도 넣는다(대화 기록·마커). 녹화 상태·주소·영상 0초 시각은 채팅이면 null이다.
    // 타임라인 영상 위치는 영상 0초 시각(없으면 면접 시작 일시) 기준이다
    public static ReplayResponse toReplay(
            InterviewSession session,
            List<QuestionAndAnswer> items,
            VideoStatus videoStatus,
            String videoUrl,
            OffsetDateTime recordingStartedAt) {
        return toReplay(session, items, videoStatus, videoUrl, recordingStartedAt, null);
    }

    /**
     * @param segments 그룹 화상 면접의 본인 답변 구간(docs/그룹면접-설계.md 6.12). 영상이 구간만 이어 붙인 파일이라 타임라인 위치를 구간 기준으로
     *     옮기고 구간 밖 점은 뺀다. 개인 면접 · 채팅은 null
     */
    public static ReplayResponse toReplay(
            InterviewSession session,
            List<QuestionAndAnswer> items,
            VideoStatus videoStatus,
            String videoUrl,
            OffsetDateTime recordingStartedAt,
            List<RecordingSegment> segments) {
        OffsetDateTime videoZero =
                recordingStartedAt != null ? recordingStartedAt : session.getStartedAt();
        Map<Integer, SegmentClock> clocks = segments == null ? null : clocks(segments);
        List<ReplayItem> replayItems =
                items.stream()
                        .sorted(Comparator.comparingInt(i -> i.question().getSeq()))
                        .map(
                                i ->
                                        new ReplayItem(
                                                i.question().getId(),
                                                i.question().getSeq(),
                                                i.question().getContent(),
                                                i.question().getCreatedAt(),
                                                i.answer() == null ? null : i.answer().getContent(),
                                                i.answer() == null
                                                        ? null
                                                        : i.answer().getCreatedAt(),
                                                i.answer() == null
                                                        ? null
                                                        : Grade.ofNullable(i.answer().getScore()),
                                                i.answer() == null || !session.isVideo()
                                                        ? null
                                                        : timeline(
                                                                i.answer(),
                                                                i.question().getSeq(),
                                                                videoZero,
                                                                clocks)))
                        .toList();
        return new ReplayResponse(
                session.getId(),
                session.getPersona(),
                session.getMode(),
                session.getApplication().getCompanyName(),
                session.getApplication().getJobTitle(),
                session.getStartedAt(),
                session.isVideo() ? recordingStartedAt : null,
                session.isVideo() ? videoStatus : null,
                session.isVideo() ? videoUrl : null,
                replayItems,
                clocks == null
                        ? null
                        : clocks.values().stream().map(SegmentClock::segment).toList());
    }

    private static ReplayTimeline timeline(
            Answer answer, int seq, OffsetDateTime videoZero, Map<Integer, SegmentClock> clocks) {
        if (clocks == null) {
            return ReplayTimelines.of(answer, videoZero);
        }
        SegmentClock clock = clocks.get(seq);
        return clock == null
                ? null
                : ReplayTimelines.of(
                        answer,
                        clock.videoZero(),
                        clock.segment().videoStart(),
                        clock.segment().videoEnd());
    }

    // 구간을 시간 순으로 이어 붙인 영상의 위치. 구간 i는 앞 구간 길이를 모두 더한 위치에서 시작한다(밀리초로 더해 오차가 쌓이지 않게 한다)
    private static Map<Integer, SegmentClock> clocks(List<RecordingSegment> segments) {
        Map<Integer, SegmentClock> clocks = new LinkedHashMap<>();
        long cursorMs = 0;
        for (RecordingSegment segment : segments) {
            long lengthMs = segment.length().toMillis();
            clocks.put(
                    segment.seq(),
                    new SegmentClock(
                            new ReplaySegment(
                                    segment.seq(),
                                    cursorMs / 1000.0,
                                    (cursorMs + lengthMs) / 1000.0,
                                    segment.start()),
                            segment.start().minus(Duration.ofMillis(cursorMs))));
            cursorMs += lengthMs;
        }
        return clocks;
    }

    /**
     * @param videoZero 이 구간이 이어 붙인 영상에서 0초였다면의 시각. 구간 안의 시각 t의 영상 위치는 t − videoZero다
     */
    private record SegmentClock(ReplaySegment segment, OffsetDateTime videoZero) {}

    static SpeechMetrics toSpeechMetrics(SpeechMetric m) {
        if (m == null) {
            return null;
        }
        return new SpeechMetrics(
                m.getFillerPerMin(),
                m.getLongPauseCount(),
                m.getSpeedDeviationPct(),
                m.getTrailingOffRatio(),
                m.getPitchRangeSt(),
                m.getGazeRatio());
    }
}
