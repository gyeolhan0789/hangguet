package com.ssafy.a301.interview.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * 면접 플랜의 자소서 주장 하나(interview_plans.claims 원소). AI 명세 2장 형식이며 AI가 필드를 더해도 읽을 수 있게 모르는 필드는 무시한다.
 *
 * @param id 주장 id. 질문의 claimId가 가리킨다
 * @param text 주장 내용
 * @param type EXPERIENCE(경험) · NUMBER(수치)
 * @param sentenceNo 자기소개서 문장 순번(1부터). 문항 순서대로 문항마다 질문, 이어서 답변의 문장을 이어 센다(AI 명세 2장). V12 전에 만든 플랜은
 *     문항으로 옮기기 전 자기소개서 글 하나로 셌다. 옮기며 붙은 질문 줄('자기소개서')이 없으므로 지금 문항 기준 번호와 그만큼 어긋난다
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record PlanClaim(String id, String text, String type, Integer sentenceNo) {}
