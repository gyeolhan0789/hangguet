-- 그룹 면접 마감 처리기 조회 정리(docs/그룹면접-설계.md 6.9 · 6.11). 1초마다 찾는 "질문을 마치고 5.8을 기다리는 면접" · "다시 들어올 시간이 지난 면접"을
-- done_at · absent_since 인덱스로 찾으면 끝난 면접의 기록까지 훑어 쌓일수록 느려진다. 진행 중 그룹 면접(부분 인덱스)에서 찾도록 바꾸고 두 인덱스는 지운다.
-- 이탈 시간을 설정값(group.absence-limit)으로 바꾸며 다시 들어올 수 있는 시각을 이탈할 때 정해 둔다(absent_until). 지금 이탈 중인 행은 이전 고정값 2분으로 채운다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '30' 행을 지운다.
--   DROP INDEX ix_interview_sessions_group_in_progress;
--   ALTER TABLE interview_group_participants DROP COLUMN absent_until;
--   CREATE INDEX ix_interview_group_participants_done ON interview_group_participants (done_at) WHERE done_at IS NOT NULL;
--   CREATE INDEX ix_interview_group_participants_absent ON interview_group_participants (absent_since) WHERE absent_since IS NOT NULL;

ALTER TABLE interview_group_participants
    -- 진행 중 이탈한 뒤 이 시각까지 다시 들어올 수 있다. 다시 들어오면 null
    ADD COLUMN absent_until TIMESTAMPTZ;

UPDATE interview_group_participants
SET absent_until = absent_since + INTERVAL '2 minutes'
WHERE absent_since IS NOT NULL;

DROP INDEX ix_interview_group_participants_done;
DROP INDEX ix_interview_group_participants_absent;

-- 진행 중 그룹 면접(6.11 마감 처리기)
CREATE INDEX ix_interview_sessions_group_in_progress ON interview_sessions (id)
    WHERE status = 'IN_PROGRESS' AND group_id IS NOT NULL;
