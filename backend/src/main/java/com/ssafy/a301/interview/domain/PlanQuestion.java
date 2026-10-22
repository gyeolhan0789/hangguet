package com.ssafy.a301.interview.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

/**
 * 면접 플랜의 질문 하나(interview_plans.questions 원소). AI 명세 2장 형식이며 AI가 필드를 더해도 읽을 수 있게 모르는 필드는 무시한다.
 *
 * @param seq 질문 순서 1~5
 * @param content 질문 내용
 * @param criteria 이 질문의 채점 기준
 * @param claimId 질문이 파고드는 자소서 주장 id
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record PlanQuestion(int seq, String content, String criteria, String claimId) {}
