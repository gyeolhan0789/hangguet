-- 녹화 합치기 상태. 면접을 끝낼 때 합친 녹화 행을 MERGING으로 만들고,
-- 결과 메시지(recording.merged · recording.mergeFailed)로 READY · FAILED로 변경한다(BE 설계 5.5).
-- 이미 있는 행은 합치기를 마친 파일이므로 READY로 채운다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '10' 행을 지운다.
--   ALTER TABLE recordings DROP COLUMN status;

ALTER TABLE recordings ADD COLUMN status VARCHAR(10) NOT NULL DEFAULT 'READY';
ALTER TABLE recordings ALTER COLUMN status DROP DEFAULT;
