package com.ssafy.a301.user.repository;

import com.ssafy.a301.user.domain.PasswordChange;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PasswordChangeRepository extends JpaRepository<PasswordChange, Long> {

    /** 회원의 마지막 비밀번호 변경 기록 시각(회원·관리자 변경). 기록이 없으면 비어 있다 */
    @Query("select max(c.changedAt) from PasswordChange c where c.userId = :userId")
    Optional<OffsetDateTime> findLatestChangedAt(@Param("userId") long userId);
}
