package com.ssafy.a301.inquiry.repository;

import com.ssafy.a301.inquiry.domain.InquiryMessage;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InquiryMessageRepository extends JpaRepository<InquiryMessage, Long> {
    /** 문의의 메시지를 오래된 순으로. 답변한 관리자 이름을 함께 읽는다 */
    @Query(
            "select m from InquiryMessage m left join fetch m.admin where m.inquiry.id = :inquiryId"
                    + " order by m.createdAt, m.id")
    List<InquiryMessage> findThread(@Param("inquiryId") long inquiryId);
}
