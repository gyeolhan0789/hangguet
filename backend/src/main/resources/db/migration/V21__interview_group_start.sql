-- 그룹 면접 시작(API 명세 10.7, docs/그룹면접-설계.md 4.2 · 6.2). 공통 질문 문항 은행과 시작할 때 정하는 진행 상태(첫 차례)를 더한다.
-- 차례 전환 · 이탈 · 종료에 쓰는 칼럼(room_version · absent_since · done_at · end_reason 등)은 진행을 구현할 때 더한다.
-- 새 테이블과 null 가능 · 기본값이 있는 칼럼만 더하므로 기존 그룹 · 참가자 행은 바뀌지 않는다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '21' 행을 지운다.
--   ALTER TABLE interview_group_participants DROP COLUMN base_done, DROP COLUMN followups_used;
--   ALTER TABLE interview_groups DROP COLUMN common_questions, DROP COLUMN round, DROP COLUMN phase,
--     DROP COLUMN turn_session_id, DROP COLUMN turn_seq, DROP COLUMN turn_kind, DROP COLUMN turn_announce,
--     DROP COLUMN turn_version, DROP COLUMN deadline_at, DROP COLUMN extended, DROP COLUMN phase_due_at,
--     DROP COLUMN progressed_at, DROP COLUMN started_at;
--   DROP TABLE group_common_questions;

-- 공통 질문 문항 은행. 시작할 때 INTRO(자기소개) 1개, CHARACTER(인성) 1개를 무작위로 고른다
CREATE TABLE group_common_questions (
    id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    type     VARCHAR(20)  NOT NULL CHECK (type IN ('INTRO', 'CHARACTER')),
    content  VARCHAR(500) NOT NULL,
    criteria VARCHAR(500) NOT NULL,
    active   BOOLEAN      NOT NULL DEFAULT TRUE
);

INSERT INTO group_common_questions (type, content, criteria) VALUES
    ('INTRO', '1분 동안 자기소개를 해 주세요.', '핵심 경험 · 지원 동기 · 전달력'),
    ('INTRO', '지원한 직무와 관련된 본인의 강점을 중심으로 자기소개를 해 주세요.', '직무 관련 강점 · 근거 경험 · 전달력'),
    ('CHARACTER', '의견이 다른 동료와 함께 문제를 해결한 경험을 말씀해 주세요.', '갈등 상황 · 본인 행동 · 결과'),
    ('CHARACTER', '팀 프로젝트에서 맡은 역할과 협업 과정에서 가장 신경 쓴 점을 말씀해 주세요.', '역할 · 협업 방식 · 기여'),
    ('CHARACTER', '예상하지 못한 문제가 생겼을 때 어떻게 해결했는지 경험을 들어 말씀해 주세요.', '문제 정의 · 해결 과정 · 배운 점'),
    ('CHARACTER', '실패했던 경험과 그 경험에서 배운 점을 말씀해 주세요.', '실패 원인 분석 · 개선 행동 · 배운 점');

-- 진행 상태(5.2). 시작 전에는 null · 기본값이다
ALTER TABLE interview_groups
    -- 시작할 때 고른 공통 질문 2개(content · criteria, 자기소개 → 인성 순서). 다시 시작해도 같은 질문을 쓴다
    ADD COLUMN common_questions JSONB,
    -- 현재 라운드 1~4
    ADD COLUMN round            INTEGER,
    -- 현재 단계 ASKING · SPEAKING · ANSWERING · DECIDING · WAITING
    ADD COLUMN phase            VARCHAR(20),
    -- 현재 답변자의 면접 · 그 면접 안의 질문 순서 · 질문 종류(COMMON · PERSONAL · FOLLOWUP) · 질문을 말할지 호명만 할지(FULL · CALL)
    ADD COLUMN turn_session_id  BIGINT REFERENCES interview_sessions (id),
    ADD COLUMN turn_seq         INTEGER,
    ADD COLUMN turn_kind        VARCHAR(20),
    ADD COLUMN turn_announce    VARCHAR(10),
    -- 차례 · 단계가 바뀔 때마다 1 증가. 면접방 정보의 순서 기준
    ADD COLUMN turn_version     INTEGER     NOT NULL DEFAULT 0,
    -- 현재 질문의 답변 마감(ANSWERING에서만)과 연장 여부
    ADD COLUMN deadline_at      TIMESTAMPTZ,
    ADD COLUMN extended         BOOLEAN     NOT NULL DEFAULT FALSE,
    -- 현재 단계가 끝나야 하는 시각(지나면 정체로 본다)과 마지막으로 차례 · 단계가 바뀐 시각
    ADD COLUMN phase_due_at     TIMESTAMPTZ,
    ADD COLUMN progressed_at    TIMESTAMPTZ,
    -- 마지막 시작 시도 시각
    ADD COLUMN started_at       TIMESTAMPTZ;

ALTER TABLE interview_group_participants
    -- 끝낸 기본 질문 수 0~4
    ADD COLUMN base_done      INTEGER NOT NULL DEFAULT 0 CHECK (base_done BETWEEN 0 AND 4),
    -- 받은 꼬리질문 수 0~2
    ADD COLUMN followups_used INTEGER NOT NULL DEFAULT 0 CHECK (followups_used BETWEEN 0 AND 2);
