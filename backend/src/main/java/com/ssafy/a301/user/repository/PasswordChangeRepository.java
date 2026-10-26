package com.ssafy.a301.user.repository;

import com.ssafy.a301.user.domain.PasswordChange;
import org.springframework.data.jpa.repository.JpaRepository;

public interface PasswordChangeRepository extends JpaRepository<PasswordChange, Long> {}
