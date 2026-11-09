-- 그룹 면접 녹화 구간(docs/그룹면접-설계.md 6.9 · 6.12). 답변 중 면접방을 나가 닫지도 답하지도 않은 질문이 끝난 시각을 남긴다.
-- 본인 답변 구간(질문 시작 ~ 답변 끝)의 끝으로 쓴다. 다시 물으면 지운다.
-- null 허용 칼럼만 더하므로 기존 행은 바뀌지 않는다.
-- 되돌리기(Rollback): 아래를 실행한 뒤 flyway_schema_history에서 version '28' 행을 지운다.
--   ALTER TABLE interview_questions DROP COLUMN interrupted_at;

ALTER TABLE interview_questions
    -- 그룹 면접에서 답변 중 나간 시각. 개인 면접은 null
    ADD COLUMN interrupted_at TIMESTAMPTZ;
