-- 그룹 면접 차례 진행(docs/그룹면접-설계.md 4.2 · 4.3 · 6.3 ~ 6.7). 차례를 정한 버전, 질문을 모두 마친 시각, 질문 종류 · 답변 시간, 답변을 끝낸 시각을 더한다.
-- null 가능 · 기본값이 있는 칼럼만 더하므로 기존 행과 개인 면접은 바뀌지 않는다(개인 면접의 질문 · 답변은 새 칼럼이 null).
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '25' 행을 지운다.
--   ALTER TABLE answers DROP COLUMN ended_at;
--   ALTER TABLE interview_questions DROP COLUMN kind, DROP COLUMN spoken_at, DROP COLUMN deadline_at, DROP COLUMN closed_at;
--   ALTER TABLE interview_group_participants DROP COLUMN done_at;
--   ALTER TABLE interview_groups DROP COLUMN turn_started_version;

-- 지금 차례를 정했을 때의 turn_version. 에이전트 메시지의 turnVersion이 이 값 이상 turn_version 이하일 때만 지금 차례의 메시지로 본다
ALTER TABLE interview_groups ADD COLUMN turn_started_version INTEGER NOT NULL DEFAULT 0;

-- 질문을 모두 마친 시각. 이 뒤에 화면이 5.8을 부른다
ALTER TABLE interview_group_participants ADD COLUMN done_at TIMESTAMPTZ;

ALTER TABLE interview_questions
    -- 그룹 면접의 질문 종류
    ADD COLUMN kind        VARCHAR(20) CHECK (kind IN ('COMMON', 'PERSONAL', 'FOLLOWUP')),
    -- 질문 음성이 끝나 답변 시간을 시작한 시각과 연장을 반영한 답변 마감
    ADD COLUMN spoken_at   TIMESTAMPTZ,
    ADD COLUMN deadline_at TIMESTAMPTZ,
    -- 답 없이 마감한 시각
    ADD COLUMN closed_at   TIMESTAMPTZ;

-- 답변을 끝낸 시각(그룹 면접. 본인 답변 구간 계산, 6.12)
ALTER TABLE answers ADD COLUMN ended_at TIMESTAMPTZ;
