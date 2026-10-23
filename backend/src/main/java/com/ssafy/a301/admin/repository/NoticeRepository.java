package com.ssafy.a301.admin.repository;

import com.ssafy.a301.admin.domain.Notice;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NoticeRepository extends JpaRepository<Notice, Long> {
    Optional<Notice> findByIdAndDeletedAtIsNull(Long id);

    /** 게시 중인 공지. 최신순(게시 시작 일시 내림차순, 같으면 id 내림차순) */
    @Query(
            """
            select n from Notice n
            where n.deletedAt is null
              and n.startsAt <= :now
              and (n.endsAt is null or n.endsAt > :now)
            order by n.startsAt desc, n.id desc
            """)
    List<Notice> findVisible(@Param("now") OffsetDateTime now);
}
