package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.InterviewSession;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InterviewSessionRepository extends JpaRepository<InterviewSession, Long> {
    Optional<InterviewSession> findByIdAndUserId(Long id, Long userId);
}
