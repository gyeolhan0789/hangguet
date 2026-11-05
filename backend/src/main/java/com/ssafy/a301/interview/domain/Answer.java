package com.ssafy.a301.interview.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.OneToOne;
import jakarta.persistence.Table;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 답변. 질문 하나에 답변 하나. 채점 결과(evaluation)는 답변 채점 결과(answer.scored)로, 점수·피드백은 결과를 만들 때 채운다. AI는 DB를 쓰지
 * 않고 BE만 쓴다(AI 명세 1.4).
 */
@Entity
@Table(name = "answers")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Answer {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "question_id", nullable = false, unique = true)
    private InterviewQuestion question;

    @Enumerated(EnumType.STRING)
    @Column(name = "input_type", nullable = false, length = 20)
    private InputType inputType;

    // 화상은 실시간 음성 인식의 최종 글, 채팅은 입력한 글
    @Column(nullable = false, columnDefinition = "TEXT")
    private String content;

    // 화상 답변의 확정 토큰과 말한 시각. 채팅이거나 보내지 않으면 null
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private List<AnswerToken> tokens;

    // 화상 답변의 말끝 흐림·억양 폭(에이전트가 계산). 채팅이면 null
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private AnswerSpeech speech;

    // 화상 답변에서 STT가 끊겨 인식하지 못한 구간(시각 순). 끊긴 적이 없거나 채팅이면 null
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "stt_gaps", columnDefinition = "jsonb")
    private List<SttGap> sttGaps;

    // 화상 답변을 듣기 시작한 시각(tokens 시각의 0ms). 채팅이면 null
    @Column(name = "started_at")
    private OffsetDateTime startedAt;

    // 답변 채점 결과(AI 명세 3장 evaluation). 채점 전에는 null
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb")
    private Map<String, Object> evaluation;

    // 0~100. 결과 생성 전에는 null
    private Integer score;

    @Column(name = "good_point", columnDefinition = "TEXT")
    private String goodPoint;

    @Column(name = "improve_point", columnDefinition = "TEXT")
    private String improvePoint;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    public Answer(InterviewQuestion question, InputType inputType, String content) {
        this(question, inputType, content, null);
    }

    public Answer(
            InterviewQuestion question,
            InputType inputType,
            String content,
            List<AnswerToken> tokens) {
        this.question = question;
        this.inputType = inputType;
        this.content = content;
        this.tokens = tokens;
    }

    /** 면접 에이전트가 보낸 화상 답변(AI 명세 6.2 answer.completed) */
    public static Answer voice(
            InterviewQuestion question,
            String content,
            List<AnswerToken> tokens,
            AnswerSpeech speech,
            List<SttGap> sttGaps,
            OffsetDateTime startedAt) {
        Answer answer = new Answer(question, InputType.VOICE, content, tokens);
        answer.speech = speech;
        answer.sttGaps = sttGaps;
        answer.startedAt = startedAt;
        return answer;
    }

    /** 채점 결과가 아직 없을 때만 남긴다. 같은 결과가 두 번 오면 처음 것을 둔다. 남겼으면 true */
    public boolean recordEvaluation(Map<String, Object> evaluation) {
        if (this.evaluation != null) {
            return false;
        }
        this.evaluation = evaluation;
        return true;
    }

    /** 결과 생성 결과(evaluation.completed). 점수·피드백을 쓰고 채점 결과를 확정본으로 덮어쓴다(5.9로 다시 만들 때 포함) */
    public void completeEvaluation(
            int score, String goodPoint, String improvePoint, Map<String, Object> evaluation) {
        evaluate(score, goodPoint, improvePoint);
        this.evaluation = evaluation;
    }

    public void evaluate(int score, String goodPoint, String improvePoint) {
        this.score = score;
        this.goodPoint = goodPoint;
        this.improvePoint = improvePoint;
    }
}
