package com.ssafy.a301.admin.repository;

import com.ssafy.a301.admin.domain.AdminDailyMetric;
import java.time.LocalDate;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AdminDailyMetricRepository extends JpaRepository<AdminDailyMetric, LocalDate> {

    /** 기간 안의 기록, 날짜 오름차순. 기록이 없는 날은 빠진다 */
    List<AdminDailyMetric> findByMetricDateBetweenOrderByMetricDateAsc(
            LocalDate from, LocalDate to);
}
