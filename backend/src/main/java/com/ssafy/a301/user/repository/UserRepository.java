package com.ssafy.a301.user.repository;

import com.ssafy.a301.user.domain.User;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, Long> {
    boolean existsByEmailAndDeletedAtIsNull(String email);

    Optional<User> findByEmailAndDeletedAtIsNull(String email);

    Optional<User> findByIdAndDeletedAtIsNull(Long id);

    /**
     * 회원 정보를 바꿀 때 쓴다(SELECT … FOR UPDATE). 같은 회원의 변경·탈퇴가 겹치면 차례로 처리해, 먼저 읽은 값으로 다른 요청의 변경을 덮어쓰지 않게
     * 한다. 기다리는 사이 탈퇴했으면 비어 있다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from User u where u.id = :id and u.deletedAt is null")
    Optional<User> findActiveForUpdate(@Param("id") long id);
}
