package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.SessionScore;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SessionScoreRepository extends JpaRepository<SessionScore, Long> {

    @Query("select s from SessionScore s where s.session.id in :sessionIds")
    List<SessionScore> findBySessionIds(@Param("sessionIds") Collection<Long> sessionIds);

    // 결과를 다시 쓰기 전에 지운다(5.9 재생성 시 유일 제약 충돌 방지)
    @Modifying
    @Query("delete from SessionScore s where s.session.id = :sessionId")
    void deleteBySessionId(@Param("sessionId") long sessionId);
}
