package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.InterviewQuestion;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InterviewQuestionRepository extends JpaRepository<InterviewQuestion, Long> {
    boolean existsByIdAndSessionId(Long id, Long sessionId);
}
