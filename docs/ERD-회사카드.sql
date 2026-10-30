-- 회사 카드 테이블 초안(PostgreSQL, 레포 Flyway 규칙). 설명은 ERD-회사카드.md
-- BE 마이그레이션(backend/src/main/resources/db/migration)의 다음 번호로 옮겨 쓴다.
-- 되돌리기(Rollback): 아래를 실행하고 flyway_schema_history에서 그 버전 행을 지운다.
--   ALTER TABLE interview_sessions DROP COLUMN company_card_id;
--   DROP TABLE company_card_imports, company_cards, company_aliases, companies;

-- 파이프라인 manifest의 회사. corp_code(DART 고유번호)로 찾는다
CREATE TABLE companies (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    corp_code  VARCHAR(8)   NOT NULL UNIQUE,
    name       VARCHAR(100) NOT NULL,
    is_listed  BOOLEAN      NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL,
    updated_at TIMESTAMPTZ  NOT NULL
);

-- 지원서 회사명 매칭용. 정규화한 이름(띄어쓰기·(주) 등 제거, 소문자)이고 적재 때마다 manifest에 맞춘다
CREATE TABLE company_aliases (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id BIGINT       NOT NULL REFERENCES companies (id),
    alias      VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ  NOT NULL
);
CREATE INDEX ix_company_aliases_company ON company_aliases (company_id);

-- 카드 JSON 그대로. 내용(content_hash)이 바뀔 때만 새 행을 넣고, 회사당 최신 카드는 하나
CREATE TABLE company_cards (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    company_id   BIGINT      NOT NULL REFERENCES companies (id),
    card         JSONB       NOT NULL,
    content_hash CHAR(64)    NOT NULL,
    generated_at DATE        NOT NULL,
    is_current   BOOLEAN     NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX uk_company_cards_current ON company_cards (company_id) WHERE is_current;
-- 지난 카드 정리(최신 아님 + 30일 지남)
CREATE INDEX ix_company_cards_stale ON company_cards (created_at) WHERE NOT is_current;

-- 적재를 마친 manifest 실행. 같은 run_id는 다시 적재하지 않는다(환경마다 따로)
CREATE TABLE company_card_imports (
    run_id      VARCHAR(50) PRIMARY KEY,
    imported_at TIMESTAMPTZ NOT NULL
);

-- 면접을 만들 때 정한 카드. PLAN·SCORE_ANSWER·EVALUATE가 같은 카드를 쓴다. 못 찾으면 NULL
-- 면접이 가리키는 카드는 지우지 않는다(FK가 막는다)
ALTER TABLE interview_sessions ADD COLUMN company_card_id BIGINT REFERENCES company_cards (id);
CREATE INDEX ix_interview_sessions_company_card ON interview_sessions (company_card_id);
