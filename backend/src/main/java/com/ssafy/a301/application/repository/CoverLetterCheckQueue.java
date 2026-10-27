package com.ssafy.a301.application.repository;

/** AI에 자기소개서 검증을 맡기고 결과를 기다린다(AI 명세 2.1). 형식은 RedisCoverLetterCheckQueue */
public interface CoverLetterCheckQueue {

    /** 판단 결과. 판단하지 못했으면(AI·Jev 장애, 기다리는 시간 초과) UNAVAILABLE */
    enum Verdict {
        USABLE,
        UNUSABLE,
        UNAVAILABLE
    }

    Verdict check(String companyName, String jobTitle, String coverLetter);
}
