package com.ssafy.a301.interview.domain;

import static com.ssafy.a301.TestEntities.withId;
import static org.assertj.core.api.Assertions.assertThat;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.user.domain.User;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** 그룹 화상 면접 녹화의 본인 답변 구간(docs/그룹면접-설계.md 6.12) */
class RecordingSegmentTest {
    private static final OffsetDateTime T0 = OffsetDateTime.parse("2026-11-04T14:00:00+09:00");
    private final InterviewSession session =
            withId(
                    new InterviewSession(
                            new User("segment@example.com", "hash", "구간"),
                            new Application(
                                    new User("segment@example.com", "hash", "구간"), "○○전자", "백엔드"),
                            Persona.DEVIL,
                            InterviewMode.VIDEO),
                    55);

    // 질문을 낸 때부터 답변 끝 · 닫힘 · 답변 중 나감 · 면접 종료까지. 시간 순이고 길이가 0인 구간은 뺀다
    @Test
    void segmentsEndAtAnswerCloseInterruptOrSessionEnd() {
        InterviewQuestion answered = question(1, 10);
        Answer answer = withId(new Answer(answered, InputType.VOICE, "답"), 901);
        answer.recordEndedAt(T0.plusSeconds(100));
        InterviewQuestion closed = question(2, 200);
        closed.close(T0.plusSeconds(300));
        InterviewQuestion interrupted = question(3, 400);
        interrupted.interrupt(T0.plusSeconds(420));
        InterviewQuestion empty = question(4, 500);
        empty.close(T0.plusSeconds(500));
        InterviewQuestion last = question(5, 600);

        List<RecordingSegment> segments =
                RecordingSegment.of(
                        List.of(last, empty, interrupted, closed, answered),
                        Map.of(answered.getId(), answer),
                        T0.plusSeconds(650));

        assertThat(segments)
                .containsExactly(
                        new RecordingSegment(1, T0.plusSeconds(10), T0.plusSeconds(100)),
                        new RecordingSegment(2, T0.plusSeconds(200), T0.plusSeconds(300)),
                        new RecordingSegment(3, T0.plusSeconds(400), T0.plusSeconds(420)),
                        new RecordingSegment(5, T0.plusSeconds(600), T0.plusSeconds(650)));
    }

    // 다시 물으면 다시 물은 때부터다. 앞 구간과 겹치면 앞 구간이 끝난 뒤부터로 줄인다
    @Test
    void reaskedQuestionStartsAgainAndSegmentsDoNotOverlap() {
        InterviewQuestion reasked = question(1, 10);
        reasked.interrupt(T0.plusSeconds(20));
        reasked.reask(T0.plusSeconds(300));
        reasked.close(T0.plusSeconds(400));
        InterviewQuestion first = question(2, 100);
        first.close(T0.plusSeconds(350));

        assertThat(RecordingSegment.of(List.of(reasked, first), Map.of(), T0.plusHours(1)))
                .containsExactly(
                        new RecordingSegment(2, T0.plusSeconds(100), T0.plusSeconds(350)),
                        new RecordingSegment(1, T0.plusSeconds(350), T0.plusSeconds(400)));
    }

    private InterviewQuestion question(int seq, int askedSecond) {
        InterviewQuestion question =
                new InterviewQuestion(session, seq, "질문 " + seq, T0.plusSeconds(askedSecond));
        // 낸 시각을 그대로 두고 id만 넣는다(withId는 created_at도 바꾼다)
        ReflectionTestUtils.setField(question, "id", 300L + seq);
        return question;
    }
}
