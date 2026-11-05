package com.ssafy.a301.group.repository;

import com.ssafy.a301.group.domain.CommonQuestionType;
import com.ssafy.a301.group.domain.GroupCommonQuestion;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GroupCommonQuestionRepository extends JpaRepository<GroupCommonQuestion, Long> {

    /** 시작할 때 고를 후보. 문항 수가 적어 모두 읽고 그중에서 고른다 */
    List<GroupCommonQuestion> findByTypeAndActiveTrue(CommonQuestionType type);
}
