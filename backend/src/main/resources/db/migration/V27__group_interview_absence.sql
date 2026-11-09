-- 그룹 면접 진행 중 이탈(docs/그룹면접-설계.md 4.2 · 6.9). 면접방에서 나간 시각을 남기고, 마감 처리기가 2분이 지난 참가자를 찾는 인덱스를 둔다.
-- null 허용 칼럼 · 인덱스만 더하므로 기존 행은 바뀌지 않는다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '27' 행을 지운다.
--   DROP INDEX ix_interview_group_participants_absent;
--   ALTER TABLE interview_group_participants DROP COLUMN absent_since;

ALTER TABLE interview_group_participants
    -- 진행 중 면접방에서 나간 시각. 다시 들어오면 null
    ADD COLUMN absent_since TIMESTAMPTZ;

-- 이탈 2분이 지난 참가자(6.9)
CREATE INDEX ix_interview_group_participants_absent ON interview_group_participants (absent_since)
    WHERE absent_since IS NOT NULL;
