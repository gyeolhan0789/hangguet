-- 그룹 면접 종료(docs/그룹면접-설계.md 4.2 · 4.3 · 6.10). 그룹 세션이 끝난 이유와 그룹이 끝난 시각을 더한다.
-- null 가능 칼럼만 더하므로 기존 행은 바뀌지 않는다(개인 면접의 end_reason은 null로 둔다).
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '23' 행을 지운다.
--   ALTER TABLE interview_sessions DROP COLUMN end_reason;
--   ALTER TABLE interview_groups DROP COLUMN ended_at;

ALTER TABLE interview_sessions
    ADD COLUMN end_reason VARCHAR(20)
        CHECK (end_reason IN ('ALL_ANSWERED', 'USER_ENDED', 'DISCONNECTED', 'AI_FAILURE', 'CLEANUP'));

ALTER TABLE interview_groups ADD COLUMN ended_at TIMESTAMPTZ;
