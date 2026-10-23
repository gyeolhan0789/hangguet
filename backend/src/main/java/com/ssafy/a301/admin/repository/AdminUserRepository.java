package com.ssafy.a301.admin.repository;

import com.ssafy.a301.user.domain.User;
import java.util.Collection;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;
import org.springframework.data.repository.query.Param;

/** 관리 페이지가 읽는 회원. 회원 모듈의 UserRepository를 바꾸지 않도록 조회만 따로 둔다. 탈퇴한 회원은 빠진다. */
public interface AdminUserRepository extends Repository<User, Long> {
    /** 이메일·닉네임에 검색어가 들어간 회원(8.12). pattern은 %·_를 이스케이프한 '%검색어%' */
    @Query(
            """
            select u from User u
            where u.deletedAt is null
              and (lower(u.email) like :pattern escape '\\'
                   or lower(u.nickname) like :pattern escape '\\')
            """)
    Page<User> search(@Param("pattern") String pattern, Pageable pageable);

    @Query("select u from User u where u.id in :ids and u.deletedAt is null")
    List<User> findActiveByIds(@Param("ids") Collection<Long> ids);

    @Query("select count(u) from User u where u.deletedAt is null")
    long countActive();
}
