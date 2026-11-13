package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.Persona;
import com.ssafy.a301.interview.domain.QuestionPoolItem;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

/** 질문 보관함(BE 설계 3장). 보관함은 지원서 + 면접관마다 하나다. */
public interface QuestionPoolItemRepository extends JpaRepository<QuestionPoolItem, Long> {

    /** 보관함의 질문을 저장한 순서대로 */
    List<QuestionPoolItem> findByApplicationIdAndPersonaOrderById(
            long applicationId, Persona persona);

    /** 배정할 수 있는(사용 처리하지 않은) 질문을 저장한 순서대로 */
    List<QuestionPoolItem> findByApplicationIdAndPersonaAndUsedAtIsNullOrderById(
            long applicationId, Persona persona);

    /** 출제한(사용 처리한) 질문을 저장한 순서대로 */
    List<QuestionPoolItem> findByApplicationIdAndPersonaAndUsedAtIsNotNullOrderById(
            long applicationId, Persona persona);
}
