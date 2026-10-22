package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.InterviewPlan;
import org.springframework.data.jpa.repository.JpaRepository;

/** 면접 플랜 조회. 쓰기는 AI 분석 작업자가 한다. */
public interface InterviewPlanRepository extends JpaRepository<InterviewPlan, Long> {}
