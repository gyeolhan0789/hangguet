-- 질문 보관함 사용 처리(BE 설계 3장 QuestionPoolItem, AI 명세 2장). 실제로 출제한(question.started) 보관함 질문은 다시 배정하지 않는다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '32' 행을 지운다.
--   ALTER TABLE question_pool_items DROP COLUMN used_at;

-- 출제한 시각. 출제하지 않은 질문은 null
ALTER TABLE question_pool_items ADD COLUMN used_at TIMESTAMPTZ;
