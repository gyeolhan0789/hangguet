package com.ssafy.a301.group.service;

import com.ssafy.a301.group.domain.InterviewGroup;
import com.ssafy.a301.group.domain.InterviewGroupParticipant;
import com.ssafy.a301.group.service.TurnPlanner.Turn;
import com.ssafy.a301.interview.domain.InterviewMode;
import com.ssafy.a301.interview.domain.InterviewQuestion;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 차례가 끝났을 때의 진행(docs/그룹면접-설계.md 6.3 · 6.4). 그룹 행 → 면접 행을 잠근 트랜잭션 안에서 부르고, 그룹 · 참가자 행만 바꾼다. 면접방 정보는
 * 부르는 쪽이 커밋 뒤에 보낸다.
 */
@Component
class GroupTurnFlow {
    private final Duration askingTimeout;
    private final Duration decisionTimeout;
    private final Duration defaultSpeech;
    private final Duration speakingGrace;
    private final Duration videoAnswerTime;
    private final Duration chatAnswerTime;
    private final Duration videoAnswerGrace;

    GroupTurnFlow(
            @Value("${group.asking-timeout:20s}") Duration askingTimeout,
            @Value("${group.followup-decision-timeout:7s}") Duration decisionTimeout,
            @Value("${group.default-speech:60s}") Duration defaultSpeech,
            @Value("${group.speaking-grace:5s}") Duration speakingGrace,
            @Value("${group.answer-time.video:2m}") Duration videoAnswerTime,
            @Value("${group.answer-time.chat:5m}") Duration chatAnswerTime,
            @Value("${group.video-answer-grace:5s}") Duration videoAnswerGrace) {
        this.askingTimeout = askingTimeout;
        this.decisionTimeout = decisionTimeout;
        this.defaultSpeech = defaultSpeech;
        this.speakingGrace = speakingGrace;
        this.videoAnswerTime = videoAnswerTime;
        this.chatAnswerTime = chatAnswerTime;
        this.videoAnswerGrace = videoAnswerGrace;
    }

    /**
     * 에이전트가 질문 음성을 보내기 시작했다(question.started → SPEAKING). 예상 음성 길이에 여유를 더한 때까지 음성이 끝났다는 메시지가 오지 않으면
     * 마감 처리기가 스스로 답변 시간을 시작한다(6.4).
     *
     * @param speechMs 예상 음성 길이. 없으면 기본값
     */
    void startSpeaking(
            InterviewGroup group, OffsetDateTime startedAt, Long speechMs, OffsetDateTime now) {
        Duration speech = speechMs == null ? defaultSpeech : Duration.ofMillis(speechMs);
        group.startSpeaking(now, startedAt.plus(speech).plus(speakingGrace));
    }

    /**
     * 질문 음성이 끝나 답변 시간을 시작한다(SPEAKING → ANSWERING, 6.6). 화상은 마감 뒤 에이전트의 자동 제출이 올 여유를 둔 뒤 질문을 닫는다.
     *
     * @param spokenAt 답변 시간을 세기 시작하는 시각
     */
    void startAnswering(
            InterviewGroup group,
            InterviewQuestion question,
            OffsetDateTime spokenAt,
            OffsetDateTime now) {
        boolean video = group.getMode() == InterviewMode.VIDEO;
        OffsetDateTime deadline = spokenAt.plus(video ? videoAnswerTime : chatAnswerTime);
        question.startAnswering(spokenAt, deadline);
        group.startAnswering(now, deadline, answeringDue(group, deadline));
    }

    /** ANSWERING 단계의 기한. 화상은 마감에 에이전트가 보내는 자동 제출을 기다리는 여유를 더한다 */
    OffsetDateTime answeringDue(InterviewGroup group, OffsetDateTime deadline) {
        return group.getMode() == InterviewMode.VIDEO ? deadline.plus(videoAnswerGrace) : deadline;
    }

    /**
     * 지금 차례의 질문을 끝냈다. 답했고 꼬리질문을 더 받을 수 있으면 에이전트의 꼬리질문 판단을 기다리고(DECIDING), 아니면 바로 다음 차례로 간다.
     *
     * @param answered 최종 답변을 저장했는지. 답 없이 마감했으면 판단하지 않는다
     * @return 꼬리질문 판단을 기다리면 true
     */
    boolean finishQuestion(
            InterviewGroup group,
            List<InterviewGroupParticipant> active,
            boolean answered,
            OffsetDateTime now) {
        InterviewGroupParticipant current = current(group, active).orElseThrow();
        current.finishQuestion(group.getTurnKind());
        if (answered && current.canReceiveFollowup()) {
            group.startDeciding(now, now.plus(decisionTimeout));
            return true;
        }
        advance(group, active, false, now);
        return false;
    }

    /**
     * 다음 차례를 정한다(6.3). 방금 답한 사람이 기본 질문을 모두 마쳤고 꼬리질문도 없으면 완료로 남긴다. 남은 질문이 없으면 차례를 비운다.
     *
     * @param followupNeeded 방금 답한 사람에게 꼬리질문이 정해졌는지
     */
    void advance(
            InterviewGroup group,
            List<InterviewGroupParticipant> active,
            boolean followupNeeded,
            OffsetDateTime now) {
        Optional<Turn> next = TurnPlanner.next(group, active, followupNeeded);
        current(group, active)
                .filter(InterviewGroupParticipant::isAnswering)
                .filter(p -> p.getBaseDone() >= InterviewGroupParticipant.BASE_QUESTIONS)
                .filter(p -> next.map(turn -> turn.participant() != p).orElse(true))
                .ifPresent(p -> p.complete(now));
        if (next.isEmpty()) {
            group.finishTurns(now);
            return;
        }
        Turn turn = next.get();
        InterviewGroupParticipant p = turn.participant();
        group.assignTurn(
                now,
                turn.round(),
                p.getSession().getId(),
                p.nextSeq(),
                turn.kind(),
                turn.announce(),
                askingTimeout);
    }

    private static Optional<InterviewGroupParticipant> current(
            InterviewGroup group, List<InterviewGroupParticipant> active) {
        return active.stream()
                .filter(p -> p.getSession().getId().equals(group.getTurnSessionId()))
                .findFirst();
    }
}
