-- AI 작업 Outbox. 업무 트랜잭션과 같은 커밋으로 남기고, 커밋 뒤 Redis 작업 큐(ai:jobs)로 보낸다(BE 설계 5·12장)
-- 보낸 기록을 남기는 로그라 면접·답변에 외래키를 걸지 않는다(정리 순서에 묶이지 않게)
CREATE TABLE ai_job_outbox (
    id           UUID PRIMARY KEY,
    job_type     VARCHAR(20) NOT NULL,
    session_id   BIGINT      NOT NULL,
    answer_id    BIGINT,
    created_at   TIMESTAMPTZ NOT NULL,
    published_at TIMESTAMPTZ
);
-- 아직 보내지 못한 작업 찾기(재발행)
CREATE INDEX ix_ai_job_outbox_unpublished ON ai_job_outbox (created_at) WHERE published_at IS NULL;
