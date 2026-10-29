package com.ssafy.a301.application.repository;

import java.util.List;

/** AI에 자기소개서 검증을 맡기고 결과를 기다린다(AI 명세 2.1). 형식은 RedisCoverLetterCheckQueue */
public interface CoverLetterCheckQueue {

    /** 판단 결과. 판단하지 못했으면(AI·Jev 장애, 기다리는 시간 초과) UNAVAILABLE */
    enum Verdict {
        USABLE,
        UNUSABLE,
        UNAVAILABLE
    }

    /** 자기소개서 문항 하나. 요청 DTO에 기대지 않도록 저장소 계층에 따로 둔다. */
    record Item(String question, String answer) {}

    /** 자기소개서는 문항 순서대로 보낸다. */
    Verdict check(String companyName, String jobTitle, List<Item> coverLetterItems);
}
