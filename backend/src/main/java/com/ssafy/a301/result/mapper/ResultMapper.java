package com.ssafy.a301.result.mapper;

import com.ssafy.a301.interview.domain.Answer;
import com.ssafy.a301.interview.domain.Grade;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import com.ssafy.a301.interview.domain.InterviewSession;
import com.ssafy.a301.interview.domain.SessionScore;
import com.ssafy.a301.interview.domain.SpeechMetric;
import com.ssafy.a301.result.dto.ResultDtos;
import com.ssafy.a301.result.dto.ResultDtos.AnswerFeedback;
import com.ssafy.a301.result.dto.ResultDtos.ReplayItem;
import com.ssafy.a301.result.dto.ResultDtos.ReplayResponse;
import com.ssafy.a301.result.dto.ResultDtos.ResultResponse;
import com.ssafy.a301.result.dto.ResultDtos.SpeechMetrics;
import java.util.Comparator;
import java.util.List;

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
                session.getSummary(),
                session.getStartedAt(),
                session.getEndedAt(),
                sessionScores,
                answers,
                session.isVideo() ? toSpeechMetrics(metric) : null);
    }

    // 6.4. 낸 질문은 답변이 없어도 넣는다(대화 기록·마커)
    public static ReplayResponse toReplay(
            InterviewSession session, List<QuestionAndAnswer> items, String videoUrl) {
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
                                                        : Grade.ofNullable(i.answer().getScore())))
                        .toList();
        return new ReplayResponse(
                session.getId(),
                session.getPersona(),
                session.getMode(),
                session.getApplication().getCompanyName(),
                session.getApplication().getJobTitle(),
                session.getStartedAt(),
                session.isVideo() ? videoUrl : null,
                replayItems);
    }

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
