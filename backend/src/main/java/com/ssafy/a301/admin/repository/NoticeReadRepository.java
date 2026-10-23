package com.ssafy.a301.admin.repository;

import com.ssafy.a301.admin.domain.NoticeRead;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NoticeReadRepository extends JpaRepository<NoticeRead, Long> {
    @Query(
            "select r.notice.id from NoticeRead r"
                    + " where r.user.id = :userId and r.notice.id in :noticeIds")
    List<Long> findReadNoticeIds(
            @Param("userId") long userId, @Param("noticeIds") Collection<Long> noticeIds);

    /**
     * 처음 확인할 때만 남긴다(8.9). 남겼으면 1, 이미 있으면 0. 같은 요청이 겹쳐 제약을 위반하면 PostgreSQL은 트랜잭션 전체가 실패하므로 ON
     * CONFLICT로 넣는다(PracticeLogRepository.insertIfAbsent와 같음).
     */
    @Modifying
    @Query(
            value =
                    "INSERT INTO notice_reads (notice_id, user_id, read_at)"
                            + " VALUES (:noticeId, :userId, now())"
                            + " ON CONFLICT (notice_id, user_id) DO NOTHING",
            nativeQuery = true)
    int insertIfAbsent(@Param("noticeId") long noticeId, @Param("userId") long userId);
}
