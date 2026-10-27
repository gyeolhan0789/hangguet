-- 회원별 면접을 시작 일시 범위로 찾을 때 쓰는 인덱스. 연습일은 한국 시간 시작일이라
-- 3.1 홈·3.2 통계·5.13 달력·5.14 목록·7.x 성장 리뷰가 (user_id, started_at) 조건으로 조회한다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '9' 행을 지운다.
--   DROP INDEX ix_interview_sessions_user_started;

CREATE INDEX ix_interview_sessions_user_started ON interview_sessions (user_id, started_at);
