-- 소셜 로그인(API 명세 1.6 · 1.7). 소셜 회원은 비밀번호가 없고, 어느 제공자의 누구인지는 user_social_accounts에 남긴다.
-- 되돌리기(Rollback): 소셜 회원(password_hash IS NULL)을 먼저 정리한 뒤 아래를 실행하고 flyway_schema_history에서 version '12' 행을 지운다.
--   DROP TABLE user_social_accounts;
--   ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 소셜 계정 연결. 회원이 탈퇴하면 withdrawn_at을 기록하고 행은 남긴다
CREATE TABLE user_social_accounts (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id          BIGINT       NOT NULL REFERENCES users (id),
    provider         VARCHAR(20)  NOT NULL,
    provider_user_id VARCHAR(255) NOT NULL,
    created_at       TIMESTAMPTZ  NOT NULL,
    withdrawn_at     TIMESTAMPTZ
);
-- 탈퇴하지 않은 연결끼리만 같은 제공자 계정 중복 불가. 탈퇴한 소셜 계정은 다시 가입할 수 있다(이메일과 같음)
CREATE UNIQUE INDEX uk_user_social_accounts_active
    ON user_social_accounts (provider, provider_user_id) WHERE withdrawn_at IS NULL;
CREATE INDEX ix_user_social_accounts_user ON user_social_accounts (user_id);
