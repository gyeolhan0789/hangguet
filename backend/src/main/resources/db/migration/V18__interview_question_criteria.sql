-- 실제로 출제한 질문의 채점 기준과 버전(AI 명세 1.4 question.started). 2·4·5번은 꼬리질문(AI 명세 2.2)이라 플랜과 다를 수 있어
-- 채점·결과 생성은 플랜이 아니라 이 행의 채점 기준을 쓴다(BE 설계 3장 InterviewQuestion).
-- criteria: 이미 있는 행은 꼬리질문 전에 플랜 질문을 그대로 낸 것이라 그 면접 플랜의 같은 seq 기준으로 채운다.
--   결과 다시 생성(5.9)은 기간 제한이 없고, 채점 기준이 없으면 AI가 작업을 거부하기 때문이다.
--   플랜이 없는 행은 없지만(question.started가 플랜 질문을 읽어 행을 만들었다) 있으면 null로 남는다. 걸리면 아래로 확인한다.
--   SELECT id, session_id, seq FROM interview_questions WHERE criteria IS NULL;
-- prompt_version · model_version: 꼬리질문만 있다. 예비 질문과 이미 있는 행은 null이다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '18' 행을 지운다.
--   ALTER TABLE interview_questions DROP COLUMN criteria, DROP COLUMN prompt_version, DROP COLUMN model_version;

ALTER TABLE interview_questions
    ADD COLUMN criteria       TEXT,
    ADD COLUMN prompt_version VARCHAR(100),
    ADD COLUMN model_version  VARCHAR(100);

-- 플랜의 seq는 1~5가 하나씩이다(plan.completed 검사). criteria IS NULL은 손으로 다시 실행해도 채운 값을 덮지 않게 한다
UPDATE interview_questions q
SET criteria = e ->> 'criteria'
FROM interview_plans p, jsonb_array_elements(p.questions) e
WHERE p.session_id = q.session_id
  AND e ->> 'seq' = q.seq::text
  AND q.criteria IS NULL;
