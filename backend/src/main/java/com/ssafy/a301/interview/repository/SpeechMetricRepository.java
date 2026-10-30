package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.SpeechMetric;
import java.math.BigDecimal;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SpeechMetricRepository extends JpaRepository<SpeechMetric, Long> {

    // 결과를 다시 쓰기 전에 지운다(5.9 재생성 시 PK 충돌 방지)
    @Modifying
    @Query("delete from SpeechMetric m where m.sessionId = :sessionId")
    void deleteBySessionId(@Param("sessionId") long sessionId);

    // 결과를 다시 쓸 때 시선 비율을 이어 쓰려고 값만 읽는다(엔티티를 읽으면 삭제 뒤 같은 id로 저장할 때 충돌한다)
    @Query("select m.gazeRatio from SpeechMetric m where m.sessionId = :sessionId")
    Optional<BigDecimal> findGazeRatio(@Param("sessionId") long sessionId);
}
