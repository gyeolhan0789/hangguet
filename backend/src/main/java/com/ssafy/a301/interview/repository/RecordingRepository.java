package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.Recording;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RecordingRepository extends JpaRepository<Recording, Long> {

    Optional<Recording> findByObjectKey(String objectKey);

    /**
     * 합치기 상태를 바꿀 때 쓴다(SELECT … FOR UPDATE). 다시 합치기(6.5)와 늦게 온 합치기 결과가 겹쳐도 한쪽이 다른 쪽의 변경을 덮어쓰지 않게 한
     * 번에 하나씩 바꾼다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from Recording r where r.objectKey = :objectKey")
    Optional<Recording> findByObjectKeyForUpdate(@Param("objectKey") String objectKey);
}
