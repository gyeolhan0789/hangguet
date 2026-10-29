package com.ssafy.a301.application.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/** 자기소개서 문항 하나(ERD cover_letter_items). 지원서를 저장할 때 함께 만들고 바꾸지 않는다. */
@Entity
@Table(name = "cover_letter_items")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CoverLetterItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "application_id", nullable = false)
    private Application application;

    // 지원서 안에서의 순서. 1부터
    @Column(name = "item_order", nullable = false)
    private int itemOrder;

    @Column(nullable = false, length = 255)
    private String question;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String answer;

    CoverLetterItem(Application application, int itemOrder, String question, String answer) {
        this.application = application;
        this.itemOrder = itemOrder;
        this.question = question;
        this.answer = answer;
    }
}
