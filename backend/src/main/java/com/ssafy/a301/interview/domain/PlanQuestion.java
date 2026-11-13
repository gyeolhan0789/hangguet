package com.ssafy.a301.interview.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.Map;

/**
 * 면접 플랜의 질문 하나(interview_plans.questions 원소). AI 명세 2장 형식이며 AI가 필드를 더해도 읽을 수 있게 모르는 필드는 무시한다.
 *
 * @param seq 질문 순서 1~5
 * @param content 질문 내용
 * @param criteria 이 질문의 채점 기준
 * @param claimId 질문이 파고드는 자소서 주장 id
 * @param companyItem 질문을 연결한 회사 항목. section(카드 칸 이름)과 그 카드 항목의 칸을 이름 그대로 담는다. 연결하지 않은 질문과 이 필드를 더하기
 *     전에 만든 플랜은 null이다(AI 명세 2장)
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record PlanQuestion(
        int seq,
        String content,
        String criteria,
        String claimId,
        Map<String, Object> companyItem) {}
