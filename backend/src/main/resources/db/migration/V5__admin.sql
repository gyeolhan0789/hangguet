-- 관리 페이지(8. 관리자): 관리자, 공지, 공지 확인, 스트릭 유지권 배포 · 배포 대상 · 유지권
-- 되돌리기(Rollback): 아래 순서로 지운 뒤 flyway_schema_history에서 version '5' 행을 지운다.
--   DROP TABLE streak_freezes; DROP TABLE streak_freeze_grant_targets; DROP TABLE streak_freeze_grants;
--   DROP TABLE notice_reads; DROP TABLE notices; DROP TABLE admins;
--   유지권으로 메운 날의 practice_logs 행은 남는다(어떤 행이 유지권으로 생겼는지 구분하지 않음)

-- 관리 페이지 계정. 회원(users)과 따로 둔다. 기동할 때 환경 변수(ADMIN_LOGIN_ID 등)로 만든다
CREATE TABLE admins (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    login_id      VARCHAR(50)  NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name          VARCHAR(50)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL,
    updated_at    TIMESTAMPTZ  NOT NULL,
    deleted_at    TIMESTAMPTZ
);
-- 삭제하지 않은 관리자끼리만 아이디 중복 불가
CREATE UNIQUE INDEX uk_admins_login_id_active ON admins (login_id) WHERE deleted_at IS NULL;

-- 공지. 게시 기간(starts_at ~ ends_at) 동안 모든 회원에게 보인다. ends_at이 없으면 계속 보인다
CREATE TABLE notices (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id   BIGINT       NOT NULL REFERENCES admins (id),
    title      VARCHAR(100) NOT NULL,
    content    TEXT         NOT NULL,
    starts_at  TIMESTAMPTZ  NOT NULL,
    ends_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ  NOT NULL,
    updated_at TIMESTAMPTZ  NOT NULL,
    deleted_at TIMESTAMPTZ
);
-- 게시 중인 공지를 최신순으로 조회(8.8)
CREATE INDEX ix_notices_starts_at ON notices (starts_at);

-- 공지 확인. 행이 있으면 그 회원이 그 공지를 확인한 것
CREATE TABLE notice_reads (
    id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    notice_id BIGINT      NOT NULL REFERENCES notices (id),
    user_id   BIGINT      NOT NULL REFERENCES users (id),
    read_at   TIMESTAMPTZ NOT NULL,
    CONSTRAINT uk_notice_reads_notice_user UNIQUE (notice_id, user_id)
);

-- 유지권 배포. 지급 날짜(한국 시간) 0시에 대상 회원마다 유지권을 개수만큼 만든다. 취소하지 않는다
CREATE TABLE streak_freeze_grants (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    admin_id      BIGINT       NOT NULL REFERENCES admins (id),
    target_type   VARCHAR(20)  NOT NULL,
    quantity      INTEGER      NOT NULL,
    grant_date    DATE         NOT NULL,
    fillable_date DATE         NOT NULL,
    reason        VARCHAR(255),
    status        VARCHAR(20)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL,
    granted_at    TIMESTAMPTZ
);
-- 지급할 배포(SCHEDULED, 지급 날짜 지남)를 찾는다
CREATE INDEX ix_streak_freeze_grants_status_date ON streak_freeze_grants (status, grant_date);

-- 지정 회원(USERS) 배포의 받을 회원
CREATE TABLE streak_freeze_grant_targets (
    id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    grant_id BIGINT NOT NULL REFERENCES streak_freeze_grants (id),
    user_id  BIGINT NOT NULL REFERENCES users (id),
    CONSTRAINT uk_streak_freeze_grant_targets_grant_user UNIQUE (grant_id, user_id)
);

-- 유지권. 한 행이 유지권 1개. 메울 수 있는 날짜(fillable_date) 하나만 연습한 날로 메운다
CREATE TABLE streak_freezes (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       BIGINT      NOT NULL REFERENCES users (id),
    grant_id      BIGINT      NOT NULL REFERENCES streak_freeze_grants (id),
    status        VARCHAR(20) NOT NULL,
    granted_at    TIMESTAMPTZ NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    fillable_date DATE        NOT NULL,
    used_at       TIMESTAMPTZ
);
-- 내 유지권(8.13)
CREATE INDEX ix_streak_freezes_user_status ON streak_freezes (user_id, status);
-- 배포별 받은 회원 수(8.10)
CREATE INDEX ix_streak_freezes_grant ON streak_freezes (grant_id);
