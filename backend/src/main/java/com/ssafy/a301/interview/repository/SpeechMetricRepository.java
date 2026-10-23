package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.SpeechMetric;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpeechMetricRepository extends JpaRepository<SpeechMetric, Long> {

    // 결과를 다시 쓰기 전에 지운다(5.9 재생성 시 PK 충돌 방지)
    @Modifying
    @Query("delete from SpeechMetric m where m.sessionId = :sessionId")
    void deleteBySessionId(@Param("sessionId") long sessionId);
}
