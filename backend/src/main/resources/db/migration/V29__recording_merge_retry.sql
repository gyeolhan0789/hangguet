-- 녹화 다시 합치기(API 명세 6.5). 합친 녹화 행에 다시 합친 횟수 · 마지막으로 합치기를 다시 요청한 시각 · 지금 기다리는 합치기 작업 id를 남긴다.
-- merge_requested_at이 있으면 다시보기(6.4)의 15분 대기를 그 시각부터 센다(없으면 지금처럼 면접 · 그룹 종료부터).
-- merge_job_id와 다른 작업의 recording.mergeFailed는 이전 시도의 늦은 실패라 버린다. 이 칼럼이 생기기 전에 넣은 작업은 null이라 모두 받는다.
-- 기존 행은 다시 합친 적이 없으므로 횟수 0, 나머지는 null이다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '29' 행을 지운다.
--   ALTER TABLE recordings DROP COLUMN merge_retry_count, DROP COLUMN merge_requested_at, DROP COLUMN merge_job_id;

ALTER TABLE recordings ADD COLUMN merge_retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recordings ALTER COLUMN merge_retry_count DROP DEFAULT;
ALTER TABLE recordings ADD COLUMN merge_requested_at TIMESTAMPTZ;
ALTER TABLE recordings ADD COLUMN merge_job_id UUID;
