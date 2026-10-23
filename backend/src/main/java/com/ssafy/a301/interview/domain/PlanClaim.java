package com.ssafy.a301.interview.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * 면접 플랜의 자소서 주장 하나(interview_plans.claims 원소). AI 명세 2장 형식이며 AI가 필드를 더해도 읽을 수 있게 모르는 필드는 무시한다.
 *
 * @param id 주장 id. 질문의 claimId가 가리킨다
 * @param text 주장 내용
 * @param type EXPERIENCE(경험) · NUMBER(수치)
 * @param sentenceNo 자소서 원문의 문장 순번
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record PlanClaim(String id, String text, String type, Integer sentenceNo) {}
