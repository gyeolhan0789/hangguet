package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.SessionScore;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SessionScoreRepository extends JpaRepository<SessionScore, Long> {

    @Query("select s from SessionScore s where s.session.id in :sessionIds")
    List<SessionScore> findBySessionIds(@Param("sessionIds") Collection<Long> sessionIds);
}
