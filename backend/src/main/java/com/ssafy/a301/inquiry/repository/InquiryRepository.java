package com.ssafy.a301.inquiry.repository;

import com.ssafy.a301.inquiry.domain.Inquiry;
import com.ssafy.a301.inquiry.domain.InquiryStatus;
import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InquiryRepository extends JpaRepository<Inquiry, Long> {
    /** 내 문의 목록(9.2) */
    Page<Inquiry> findByUserId(long userId, Pageable pageable);

    /** 관리자 문의 목록(9.6) 상태 필터 */
    Page<Inquiry> findByStatus(InquiryStatus status, Pageable pageable);

    /** 관리자 문의 조회(9.7). 회원 닉네임을 함께 읽는다 */
    @Query("select i from Inquiry i left join fetch i.user where i.id = :id")
    Optional<Inquiry> findWithUser(@Param("id") long id);

    /** 메시지를 달거나 종료할 때 쓴다(SELECT … FOR UPDATE). 같은 문의의 쓰기 · 종료가 겹치면 차례로 처리한다 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from Inquiry i where i.id = :id")
    Optional<Inquiry> findForUpdate(@Param("id") long id);
}
