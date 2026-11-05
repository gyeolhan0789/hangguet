package com.ssafy.a301.group.domain;

/**
 * 시작할 때 고른 공통 질문 하나(interview_groups.common_questions 원소). 에이전트 배정 정보에 그대로 담는다(AI 명세 6.7).
 *
 * @param content 질문 내용
 * @param criteria 채점 기준
 */
public record CommonQuestion(String content, String criteria) {}
