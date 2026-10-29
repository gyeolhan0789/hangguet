package com.ssafy.a301.user.repository;

import com.ssafy.a301.user.domain.SocialProvider;
import com.ssafy.a301.user.domain.UserSocialAccount;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface UserSocialAccountRepository extends JpaRepository<UserSocialAccount, Long> {
    /** 탈퇴하지 않은 연결과 그 회원 */
    @Query(
            "select a from UserSocialAccount a join fetch a.user where a.provider = :provider and"
                    + " a.providerUserId = :providerUserId and a.withdrawnAt is null")
    Optional<UserSocialAccount> findActive(
            @Param("provider") SocialProvider provider,
            @Param("providerUserId") String providerUserId);

    /** 소셜 회원이 가입한 제공자. 소셜 회원은 연결이 하나뿐이다 */
    @Query(
            "select a.provider from UserSocialAccount a where a.user.id = :userId and a.withdrawnAt"
                    + " is null")
    Optional<SocialProvider> findActiveProvider(@Param("userId") long userId);

    /** 탈퇴(2.7). 회원 행을 잠근 트랜잭션 안에서 부른다 */
    @Modifying
    @Query(
            "update UserSocialAccount a set a.withdrawnAt = :now where a.user.id = :userId and"
                    + " a.withdrawnAt is null")
    int withdrawAll(@Param("userId") long userId, @Param("now") OffsetDateTime now);
}
