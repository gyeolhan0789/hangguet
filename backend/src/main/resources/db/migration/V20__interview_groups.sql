-- 그룹 면접(docs/그룹면접-설계.md 4장, API 명세 10장). 참가자마다 개인 면접(interview_sessions)을 하나씩 두고 그룹이 그 면접들을 묶는다.
-- 이번에는 만들기 · 참가 · 대기실(10.1~10.6)에 쓰는 칼럼만 만든다. 진행 상태(차례 · 마감 등)는 시작(10.7)을 구현할 때 더한다.
-- 새 테이블과 null 가능 칼럼만 더하므로 기존 행과 개인 면접은 바뀌지 않는다(개인 면접의 group_id는 null).
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '20' 행을 지운다.
--   ALTER TABLE interview_sessions DROP COLUMN group_id;
--   DROP TABLE interview_group_participants;
--   DROP TABLE interview_groups;

CREATE TABLE interview_groups (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- 지금 방장. 방장이 나가거나 대기실 조회를 멈추면 바뀐다
    host_user_id BIGINT      NOT NULL REFERENCES users (id),
    mode         VARCHAR(20) NOT NULL,
    persona      VARCHAR(20) NOT NULL,
    job_category VARCHAR(30) NOT NULL,
    capacity     INTEGER     NOT NULL CHECK (capacity BETWEEN 2 AND 3),
    status       VARCHAR(20) NOT NULL,
    invite_code  VARCHAR(6)  NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL
);
-- 초대 코드는 대기 중인 그룹끼리만 겹치지 않으면 된다(시작 · 취소한 그룹의 코드는 다시 쓸 수 있다)
CREATE UNIQUE INDEX uk_interview_groups_invite_code_waiting
    ON interview_groups (invite_code) WHERE status = 'WAITING';

CREATE TABLE interview_group_participants (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id     BIGINT      NOT NULL REFERENCES interview_groups (id),
    user_id      BIGINT      NOT NULL REFERENCES users (id),
    session_id   BIGINT      NOT NULL UNIQUE REFERENCES interview_sessions (id),
    job_category VARCHAR(30) NOT NULL,
    -- 입장 시각. 방장을 넘길 순서의 기준
    joined_at    TIMESTAMPTZ NOT NULL,
    -- 준비 완료 시각. 취소하면 null
    ready_at     TIMESTAMPTZ,
    -- 답변 순서(1부터). 시작 전에는 null
    turn_order   INTEGER,
    -- 대기실 · 시작 실패 상태에서 나간 시각
    left_at      TIMESTAMPTZ
);
-- 나가지 않은 참가자는 그룹마다 한 번만
CREATE UNIQUE INDEX uk_interview_group_participants_group_user
    ON interview_group_participants (group_id, user_id) WHERE left_at IS NULL;
-- 회원이 참가 중인 그룹 찾기(다른 그룹 참가 확인)
CREATE INDEX ix_interview_group_participants_user ON interview_group_participants (user_id);

ALTER TABLE interview_sessions ADD COLUMN group_id BIGINT REFERENCES interview_groups (id);
CREATE INDEX ix_interview_sessions_group ON interview_sessions (group_id) WHERE group_id IS NOT NULL;
