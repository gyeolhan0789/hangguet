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
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.CreationTimestamp;

/** 답변. 질문 하나에 답변 하나. 점수·피드백은 결과를 만들 때 채운다. */
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
        this.question = question;
        this.inputType = inputType;
        this.content = content;
    }

    public void evaluate(int score, String goodPoint, String improvePoint) {
        this.score = score;
        this.goodPoint = goodPoint;
        this.improvePoint = improvePoint;
    }
}
