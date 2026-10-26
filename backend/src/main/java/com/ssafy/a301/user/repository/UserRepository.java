package com.ssafy.a301.user.repository;

import com.ssafy.a301.user.domain.User;
import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserRepository extends JpaRepository<User, Long> {
    /** 탈퇴하지 않은 회원 중 이메일이 같은(대소문자 무시) 회원이 있는지. email은 User.normalizeEmail로 바꿔 넘긴다 */
    @Query("select count(u) > 0 from User u where lower(u.email) = :email and u.deletedAt is null")
    boolean existsActiveByEmail(@Param("email") String email);

    /**
     * 탈퇴하지 않은 회원을 이메일(대소문자 무시)로 찾는다. email은 User.normalizeEmail로 바꿔 넘긴다. 소문자로 저장하기 전에 가입한 데이터에는
     * 대소문자만 다른 계정이 둘 이상 있을 수 있어 목록으로 준다
     */
    @Query(
            "select u from User u where lower(u.email) = :email and u.deletedAt is null order by"
                    + " u.id")
    List<User> findActiveByEmail(@Param("email") String email);

    Optional<User> findByIdAndDeletedAtIsNull(Long id);

    /**
     * 회원 정보를 바꿀 때 쓴다(SELECT … FOR UPDATE). 같은 회원의 변경·탈퇴가 겹치면 차례로 처리해, 먼저 읽은 값으로 다른 요청의 변경을 덮어쓰지 않게
     * 한다. 기다리는 사이 탈퇴했으면 비어 있다.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select u from User u where u.id = :id and u.deletedAt is null")
    Optional<User> findActiveForUpdate(@Param("id") long id);
}
