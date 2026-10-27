-- 결과 화면 맨 위의 한 줄 총평(30자 이내). 결과 생성(evaluation.completed)으로 받는다(AI 명세 4장).
-- summary는 성장 리뷰의 "다음에 해볼 것"(그날 면접을 모두 반영한 요약)으로 쓴다.
-- 이미 끝난 면접은 값이 없다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '11' 행을 지운다.
--   ALTER TABLE interview_sessions DROP COLUMN headline;

ALTER TABLE interview_sessions ADD COLUMN headline VARCHAR(30);
