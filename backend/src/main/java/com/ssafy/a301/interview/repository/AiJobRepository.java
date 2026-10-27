package com.ssafy.a301.interview.repository;

import com.ssafy.a301.interview.domain.AiJob;
import com.ssafy.a301.interview.domain.AiJobType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

/** AI 작업 Outbox. 보낼 작업은 잠가서(SKIP LOCKED) 가져와 같은 작업을 동시에 두 번 보내지 않는다. */
public interface AiJobRepository extends JpaRepository<AiJob, UUID> {

    /** 임시(HeadlineBackfill): 이 면접에 이 작업을 보낸 적이 있는지 */
    boolean existsByJobTypeAndSessionId(AiJobType jobType, Long sessionId);

    /** 커밋 직후 보낼 작업. 이미 보냈거나 재발행이 잡고 있으면 비어 있다. */
    @Query(
            value =
                    "SELECT * FROM ai_job_outbox WHERE id = :id AND published_at IS NULL"
                            + " FOR UPDATE SKIP LOCKED",
            nativeQuery = true)
    Optional<AiJob> findUnpublishedForUpdate(@Param("id") UUID id);

    /** 아직 보내지 못한 작업을 오래된 순으로. 다른 쪽이 잡고 있는 작업은 건너뛴다. */
    @Query(
            value =
                    "SELECT * FROM ai_job_outbox WHERE published_at IS NULL ORDER BY created_at"
                            + " LIMIT :limit FOR UPDATE SKIP LOCKED",
            nativeQuery = true)
    List<AiJob> findUnpublishedForUpdate(@Param("limit") int limit);
}
