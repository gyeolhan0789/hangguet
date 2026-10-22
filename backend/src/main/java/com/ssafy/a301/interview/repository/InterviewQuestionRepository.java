package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.InterviewQuestion;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InterviewQuestionRepository extends JpaRepository<InterviewQuestion, Long> {
    boolean existsByIdAndSessionId(Long id, Long sessionId);

    /** 면접에서 마지막으로 낸 질문 */
    Optional<InterviewQuestion> findFirstBySessionIdOrderBySeqDesc(Long sessionId);
}
