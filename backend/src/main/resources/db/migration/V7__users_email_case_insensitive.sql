-- 이메일을 대소문자 구분 없이 찾을 때(lower(email)) 쓰는 인덱스. 1.1 · 1.2 · 1.3이 이 조건으로 조회한다.
-- 대소문자 무시 중복은 가입 때 코드가 막는다(새 이메일은 소문자로 저장하고, 대소문자 무시로 먼저 확인).
-- 이미 대소문자만 다른 이메일이 있어도 실패하지 않도록 유일 인덱스가 아닌 일반 인덱스로 둔다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '7' 행을 지운다.
--   DROP INDEX ix_users_email_lower;

CREATE INDEX ix_users_email_lower ON users (lower(email)) WHERE deleted_at IS NULL;
