-- 그룹 면접 마감 처리기(docs/그룹면접-설계.md 6.5 · 6.11 · 6.14). 면접방 정보를 마지막으로 반영한 버전과 채팅 답변을 에이전트에 전한 차례를 더하고,
-- 마감 처리기가 1초마다 찾는 기한 · 완료 시각에 인덱스를 둔다.
-- 기본값이 있는 칼럼 · 인덱스만 더하므로 기존 행은 바뀌지 않는다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '26' 행을 지운다.
--   DROP INDEX ix_interview_group_participants_done;
--   DROP INDEX ix_interview_groups_due;
--   ALTER TABLE interview_groups DROP COLUMN room_version, DROP COLUMN answer_sent_version;

ALTER TABLE interview_groups
    -- LiveKit 면접방 정보에 마지막으로 반영한 turn_version. turn_version보다 작으면 마감 처리기가 다시 보낸다(6.5 재동기화)
    ADD COLUMN room_version        INTEGER NOT NULL DEFAULT 0,
    -- 채팅 최종 답변(group.answer)을 에이전트에 전한 차례의 turn_version. 꼬리질문 판단(DECIDING) 중 지금 버전보다 작으면 다시 보낸다(6.14)
    ADD COLUMN answer_sent_version INTEGER NOT NULL DEFAULT 0;

-- 진행 중 그룹의 단계 기한(6.11)
CREATE INDEX ix_interview_groups_due ON interview_groups (phase_due_at) WHERE status = 'IN_PROGRESS';
-- 질문을 모두 마친 뒤 5.8을 기다리는 참가자(6.10)
CREATE INDEX ix_interview_group_participants_done ON interview_group_participants (done_at)
    WHERE done_at IS NOT NULL;
