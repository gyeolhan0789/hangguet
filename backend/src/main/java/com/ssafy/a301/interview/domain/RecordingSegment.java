package com.ssafy.a301.interview.domain;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 그룹 화상 면접 녹화의 본인 답변 구간 하나(docs/그룹면접-설계.md 6.12). 합치기 작업(AI 명세 7장)은 이 구간만 잘라 이어 붙이고, 다시보기(API 명세
 * 6.4)는 같은 구간으로 이어 붙인 영상의 위치를 계산한다.
 *
 * @param seq 그 면접 안의 질문 순서
 * @param start 질문을 낸 시각(question.started)
 * @param end 답변을 끝낸 시각. 답이 없으면 닫은 시각, 답변 중 나갔으면 나간 시각, 그 질문 중에 면접이 끝났으면 면접을 끝낸 시각
 */
public record RecordingSegment(int seq, OffsetDateTime start, OffsetDateTime end) {

    /**
     * 면접의 질문마다 구간을 시간 순으로 만든다. 길이가 0인 구간은 빼고, 앞 구간과 겹치면 앞 구간이 끝난 뒤부터로 줄인다.
     *
     * @param answerByQuestion 질문 id별 답변
     */
    public static List<RecordingSegment> of(
            List<InterviewQuestion> questions,
            Map<Long, Answer> answerByQuestion,
            OffsetDateTime sessionEndedAt) {
        List<RecordingSegment> segments = new ArrayList<>();
        OffsetDateTime previousEnd = null;
        for (InterviewQuestion question :
                questions.stream()
                        .sorted(Comparator.comparing(InterviewQuestion::getCreatedAt))
                        .toList()) {
            OffsetDateTime start = question.getCreatedAt();
            if (previousEnd != null && start.isBefore(previousEnd)) {
                start = previousEnd;
            }
            OffsetDateTime end =
                    end(question, answerByQuestion.get(question.getId()), sessionEndedAt);
            if (end == null || !end.isAfter(start)) {
                continue;
            }
            segments.add(new RecordingSegment(question.getSeq(), start, end));
            previousEnd = end;
        }
        return segments;
    }

    public Duration length() {
        return Duration.between(start, end);
    }

    private static OffsetDateTime end(
            InterviewQuestion question, Answer answer, OffsetDateTime sessionEndedAt) {
        if (answer != null) {
            return answer.getEndedAt() != null ? answer.getEndedAt() : answer.getCreatedAt();
        }
        if (question.getClosedAt() != null) {
            return question.getClosedAt();
        }
        if (question.getInterruptedAt() != null) {
            return question.getInterruptedAt();
        }
        return sessionEndedAt;
    }
}
