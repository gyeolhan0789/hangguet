-- 화상 답변에서 STT 연결이 끊겨 음성을 인식하지 못한 구간(AI 명세 6.2 answer.completed의 sttGaps)
-- 채점(SCORE_ANSWER)은 답변 저장 뒤 따로 도는 작업이라, 채점 · 결과 생성 작업에 넘기도록 답변과 함께 둔다. 끊긴 적이 없거나 채팅이면 null
-- null 가능 칼럼만 더하므로 기존 답변 행은 바뀌지 않는다.
-- 되돌리기(Rollback): ALTER TABLE answers DROP COLUMN stt_gaps; 실행 뒤 flyway_schema_history에서 version '22' 행을 지운다.
ALTER TABLE answers
    ADD COLUMN stt_gaps JSONB;
