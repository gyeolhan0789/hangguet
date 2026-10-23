-- 화상 답변의 음성 지표와 듣기 시작한 시각(AI 명세 6.2 answer.completed)
-- speech: 에이전트가 실시간 음성으로 구한 말끝 흐림·억양 폭. 채점이 실패해도 결과 생성에 쓰도록 답변과 함께 둔다
-- started_at: 에이전트가 답변을 듣기 시작한 시각(tokens 시각의 0ms). 다시보기에서 녹화 시작 시각과의 차이로 답변 위치를 구한다
ALTER TABLE answers
    ADD COLUMN speech     JSONB,
    ADD COLUMN started_at TIMESTAMPTZ;
