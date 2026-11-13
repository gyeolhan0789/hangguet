-- 질문 보관함(BE 설계 3장 ApplicationClaim · QuestionPoolItem, AI 명세 2장).
-- 지원서 주장은 지원서를 저장한 뒤 한 번만 추출해 남기고, 개인 면접 질문 생성에 입력으로 쓴다.
-- 생성한 개인 면접 질문은 지원서 + 면접관마다 보관해, 출제하지 않은 예비 질문을 다음 면접에서 다시 쓴다.
-- 주장 추출(EXTRACT_CLAIMS)은 면접이 아니라 지원서 단위 작업이라 Outbox에 면접 id 대신 지원서 id를 남긴다(AI 명세 1.3).
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '31' 행을 지운다.
--   DROP TABLE question_pool_items;
--   DROP TABLE application_claims;
--   DELETE FROM ai_job_outbox WHERE session_id IS NULL;
--   ALTER TABLE ai_job_outbox DROP CONSTRAINT ck_ai_job_outbox_target;
--   ALTER TABLE ai_job_outbox DROP COLUMN application_id;
--   ALTER TABLE ai_job_outbox ALTER COLUMN session_id SET NOT NULL;

ALTER TABLE ai_job_outbox ALTER COLUMN session_id DROP NOT NULL;
-- 주장 추출만 값이 있다. 보낸 기록을 남기는 로그라 외래키를 걸지 않는다(V3과 같음)
ALTER TABLE ai_job_outbox ADD COLUMN application_id BIGINT;
ALTER TABLE ai_job_outbox
    ADD CONSTRAINT ck_ai_job_outbox_target CHECK ((session_id IS NULL) <> (application_id IS NULL));

-- 지원서 자기소개서에서 추출한 주장. 주장 추출 결과(claims.extracted)를 그 지원서에 주장이 없을 때만 저장하고 바꾸지 않는다
CREATE TABLE application_claims (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id  BIGINT       NOT NULL REFERENCES applications (id),
    -- AI가 붙인 주장 id. 질문의 claimId가 가리킨다
    claim_id        VARCHAR(50)  NOT NULL,
    text            TEXT         NOT NULL,
    type            VARCHAR(20)  NOT NULL,
    sentence_no     INT          NOT NULL,
    talent_criteria JSONB,
    prompt_version  VARCHAR(100) NOT NULL,
    model_version   VARCHAR(100) NOT NULL,
    created_at      TIMESTAMPTZ  NOT NULL,
    CONSTRAINT ck_application_claims_type CHECK (type IN ('EXPERIENCE', 'NUMBER')),
    CONSTRAINT uk_application_claims_application_claim UNIQUE (application_id, claim_id)
);

-- 질문 보관함. 지원서 + 면접관마다 하나이고 질문마다 한 행이다. 저장 순서(id)로 배정 순서를 정한다
CREATE TABLE question_pool_items (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id BIGINT       NOT NULL REFERENCES applications (id),
    persona        VARCHAR(20)  NOT NULL,
    content        TEXT         NOT NULL,
    criteria       TEXT         NOT NULL,
    -- 질문이 파고드는 주장 id. 주장 없이 질문 생성 안에서 추출한 주장도 가리킬 수 있어 외래키를 걸지 않는다
    claim_id       VARCHAR(50),
    -- 질문을 연결한 회사 항목. 연결하지 않은 질문은 null
    company_item   JSONB,
    prompt_version VARCHAR(100) NOT NULL,
    model_version  VARCHAR(100) NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL
);
CREATE INDEX ix_question_pool_items_application_persona ON question_pool_items (application_id, persona);
