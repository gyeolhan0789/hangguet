-- 면접 플랜과 답변 토큰·채점 결과(API 명세 B-9). JSON 형식은 AI 명세 2·3장

-- 면접 플랜. AI 분석 작업자(PLAN)가 면접당 한 번 쓰고, BE는 질문을 낼 때(5.4·5.7) 읽는다
CREATE TABLE interview_plans (
    session_id     BIGINT PRIMARY KEY REFERENCES interview_sessions (id),
    claims         JSONB        NOT NULL,
    questions      JSONB        NOT NULL,
    prompt_version VARCHAR(100) NOT NULL,
    model_version  VARCHAR(100) NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL
);

-- tokens: 5.7 화상 답변의 확정 토큰과 말한 시각. 채팅이거나 보내지 않으면 null
-- evaluation: SCORE_ANSWER 판정 결과. AI 분석 작업자만 쓴다
ALTER TABLE answers
    ADD COLUMN tokens     JSONB,
    ADD COLUMN evaluation JSONB;
