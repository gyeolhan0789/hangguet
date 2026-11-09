package com.ssafy.a301.group.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 공통 질문 문항 은행(docs/그룹면접-설계.md 4.2). 처음 문항은 Flyway로 넣고 BE는 읽기만 한다. */
@Entity
@Table(name = "group_common_questions")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class GroupCommonQuestion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private CommonQuestionType type;

    @Column(nullable = false, length = 500)
    private String content;

    @Column(nullable = false, length = 500)
    private String criteria;

    @Column(nullable = false)
    private boolean active;

    public CommonQuestion toQuestion() {
        return new CommonQuestion(content, criteria);
    }
}
