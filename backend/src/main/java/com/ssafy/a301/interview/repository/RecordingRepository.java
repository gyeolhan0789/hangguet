package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.Recording;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RecordingRepository extends JpaRepository<Recording, Long> {

    boolean existsByObjectKey(String objectKey);
}
