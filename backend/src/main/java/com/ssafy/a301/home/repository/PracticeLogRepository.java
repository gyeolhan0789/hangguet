package com.ssafy.a301.home.repository;

import com.ssafy.a301.home.domain.PracticeLog;
import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PracticeLogRepository extends JpaRepository<PracticeLog, Long> {
    @Query("select p.practiceDate from PracticeLog p where p.user.id = :userId")
    List<LocalDate> findPracticeDatesByUserId(@Param("userId") long userId);
}
