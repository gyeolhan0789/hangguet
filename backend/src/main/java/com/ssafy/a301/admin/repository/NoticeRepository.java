package com.ssafy.a301.admin.repository;

import com.ssafy.a301.admin.domain.Notice;
import jakarta.persistence.LockModeType;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface NoticeRepository extends JpaRepository<Notice, Long> {
    Optional<Notice> findByIdAndDeletedAtIsNull(Long id);

    /** 관리 페이지 목록(8.3). 삭제하지 않은 공지 */
    Page<Notice> findByDeletedAtIsNull(Pageable pageable);

    /** 관리 페이지 조회(8.5). 응답에 작성한 관리자 이름이 필요해 관리자를 함께 가져온다 */
    @Query("select n from Notice n join fetch n.admin where n.id = :id and n.deletedAt is null")
    Optional<Notice> findWithAdmin(@Param("id") long id);

    /** 수정 · 삭제(8.6 · 8.7)할 때 쓴다(SELECT … FOR UPDATE). 같은 공지를 동시에 고쳐도 차례로 처리한다 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select n from Notice n join fetch n.admin where n.id = :id and n.deletedAt is null")
    Optional<Notice> findForUpdate(@Param("id") long id);

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
