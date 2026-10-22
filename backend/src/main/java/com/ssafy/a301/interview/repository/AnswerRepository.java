package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.Answer;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface AnswerRepository extends JpaRepository<Answer, Long> {

    interface SessionAnswerCount {
        Long getSessionId();

        long getAnsweredCount();
    }

    @Query(
            """
            select a.question.session.id as sessionId, count(a) as answeredCount
            from Answer a
            where a.question.session.id in :sessionIds
            group by a.question.session.id
            """)
    List<SessionAnswerCount> countBySessionIds(@Param("sessionIds") Collection<Long> sessionIds);

    boolean existsByQuestionId(Long questionId);

    /** 면접에서 지금까지 낸 답변 수 */
    int countByQuestionSessionId(Long sessionId);
}
