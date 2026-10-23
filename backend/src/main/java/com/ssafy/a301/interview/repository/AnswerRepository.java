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

    /** 결과 생성 작업 메시지용. 질문을 함께 가져와 질문 순서대로 준다 */
    @Query(
            "select a from Answer a join fetch a.question q where q.session.id = :sessionId"
                    + " order by q.seq")
    List<Answer> findWithQuestionBySessionId(@Param("sessionId") long sessionId);
}
