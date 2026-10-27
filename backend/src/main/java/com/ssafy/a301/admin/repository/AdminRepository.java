package com.ssafy.a301.admin.repository;

import com.ssafy.a301.admin.domain.Admin;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface AdminRepository extends JpaRepository<Admin, Long> {
    Optional<Admin> findByLoginIdAndDeletedAtIsNull(String loginId);

    Optional<Admin> findByIdAndDeletedAtIsNull(Long id);

    boolean existsByLoginIdAndDeletedAtIsNull(String loginId);
}
