-- 비밀번호 변경 시 기존 액세스 토큰 무효화(BE 설계 9장). 마지막 비밀번호 변경 시각을 회원 행에 두어,
-- 토큰 검증이 이미 읽는 회원 행만으로 변경 전에 발급한 액세스 토큰을 거절한다(요청마다 쿼리를 늘리지 않음).
-- 기존 변경 기록(password_changes)의 마지막 시각으로 채운다. 바꾼 적 없는 회원은 null.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '24' 행을 지운다.
--   ALTER TABLE users DROP COLUMN password_changed_at;

ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ;

UPDATE users u
SET password_changed_at = c.changed_at
FROM (SELECT user_id, MAX(changed_at) AS changed_at FROM password_changes GROUP BY user_id) c
WHERE c.user_id = u.id;
