package com.ssafy.a301.inquiry.repository;

import com.ssafy.a301.inquiry.domain.InquiryAttachment;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface InquiryAttachmentRepository extends JpaRepository<InquiryAttachment, Long> {
    /** 메시지들의 사진을 붙인 순으로 */
    @Query("select a from InquiryAttachment a where a.message.id in :messageIds order by a.id")
    List<InquiryAttachment> findByMessages(@Param("messageIds") Collection<Long> messageIds);
}
