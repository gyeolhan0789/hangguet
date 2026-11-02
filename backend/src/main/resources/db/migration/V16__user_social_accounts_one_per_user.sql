-- 회원마다 탈퇴하지 않은 소셜 연결은 하나(API 명세 2.12). 소셜 회원은 가입한 계정, 이메일 회원은 직접 연결한 계정 하나만 가진다.
-- 지금까지 연결을 둘 이상 만드는 경로가 없어 기존 데이터는 걸리지 않는다. 걸리면 아래로 확인한다.
--   SELECT user_id FROM user_social_accounts WHERE withdrawn_at IS NULL GROUP BY user_id HAVING count(*) > 1;
-- 되돌리기(Rollback): 아래를 실행하고 flyway_schema_history에서 version '16' 행을 지운다.
--   DROP INDEX uk_user_social_accounts_user_active;

CREATE UNIQUE INDEX uk_user_social_accounts_user_active
    ON user_social_accounts (user_id) WHERE withdrawn_at IS NULL;
