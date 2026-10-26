-- 9. 문의: 문의, 문의 메시지, 비밀번호 변경 기록
-- 되돌리기(Rollback): 아래 순서로 지운 뒤 flyway_schema_history에서 version '6' 행을 지운다.
--   DROP TABLE password_changes; DROP TABLE inquiry_messages; DROP TABLE inquiries;
--   바뀐 비밀번호(users.password_hash)는 되돌리지 않는다

-- 문의. 한 건이 질문 · 답변을 여러 번 주고받는 대화 하나이고 id가 문의번호다.
-- 회원 문의는 user_id, 비회원 문의는 access_password_hash(조회 비밀번호 해시)가 있다. 제목은 AES-256-GCM으로 암호화해 저장한다
CREATE TABLE inquiries (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id              BIGINT       REFERENCES users (id),
    email                VARCHAR(255) NOT NULL,
    title                TEXT         NOT NULL,
    status               VARCHAR(20)  NOT NULL,
    access_password_hash VARCHAR(255),
    created_at           TIMESTAMPTZ  NOT NULL,
    updated_at           TIMESTAMPTZ  NOT NULL
);
-- 내 문의 목록(9.2)
CREATE INDEX ix_inquiries_user_created ON inquiries (user_id, created_at);
-- 관리자 문의 목록(9.6) 상태 필터
CREATE INDEX ix_inquiries_status_created ON inquiries (status, created_at);

-- 문의 메시지. 한 행이 질문(USER) 또는 답변(ADMIN) 하나. 본문은 AES-256-GCM으로 암호화해 저장한다
CREATE TABLE inquiry_messages (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inquiry_id  BIGINT      NOT NULL REFERENCES inquiries (id),
    author_type VARCHAR(20) NOT NULL,
    admin_id    BIGINT      REFERENCES admins (id),
    content     TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_inquiry_messages_inquiry ON inquiry_messages (inquiry_id);

-- 비밀번호 변경 기록. 비밀번호 값은 저장하지 않는다
CREATE TABLE password_changes (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES users (id),
    changed_by VARCHAR(20) NOT NULL,
    admin_id   BIGINT      REFERENCES admins (id),
    inquiry_id BIGINT      REFERENCES inquiries (id),
    changed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_password_changes_user ON password_changes (user_id);
