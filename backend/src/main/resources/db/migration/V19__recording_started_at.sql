-- 합친 녹화의 0초에 해당하는 시각. recording.merged의 recordingStartedAt을 저장하고,
-- 다시보기(6.4)가 질문 마커·답변 타임라인 위치의 기준으로 쓴다(AI 명세 7장, BE 설계 처리 순서 11).
-- AI가 시작 시각 없이 이어 붙여 합쳤거나 V19 전에 합친 녹화는 null이고, 이때 화면은 면접 started_at을 기준으로 쓴다.
-- 기본값 없는 null 가능 칼럼이라 기존 행을 다시 쓰지 않는다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '19' 행을 지운다.
--   ALTER TABLE recordings DROP COLUMN recording_started_at;

ALTER TABLE recordings ADD COLUMN recording_started_at TIMESTAMPTZ;
