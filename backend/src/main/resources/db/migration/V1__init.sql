-- 초기 스키마. 테이블 10개

CREATE TABLE users (
    id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email             VARCHAR(255) NOT NULL,
    password_hash     VARCHAR(255) NOT NULL,
    nickname          VARCHAR(50)  NOT NULL,
    profile_image_key VARCHAR(500),
    created_at        TIMESTAMPTZ  NOT NULL,
    updated_at        TIMESTAMPTZ  NOT NULL,
    deleted_at        TIMESTAMPTZ
);
-- 탈퇴하지 않은 회원끼리만 이메일 중복 불가
CREATE UNIQUE INDEX uk_users_email_active ON users (email) WHERE deleted_at IS NULL;

CREATE TABLE user_agreements (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       BIGINT      NOT NULL REFERENCES users (id),
    terms_type    VARCHAR(20) NOT NULL,
    terms_version VARCHAR(20) NOT NULL,
    agreed_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_user_agreements_user ON user_agreements (user_id);

CREATE TABLE applications (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      BIGINT       NOT NULL REFERENCES users (id),
    company_name VARCHAR(100) NOT NULL,
    job_title    VARCHAR(100) NOT NULL,
    cover_letter TEXT         NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL
);
-- 지원서 목록(최근 작성 순)
CREATE INDEX ix_applications_user_created ON applications (user_id, created_at DESC);

CREATE TABLE interview_sessions (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id        BIGINT       NOT NULL REFERENCES users (id),
    application_id BIGINT       NOT NULL REFERENCES applications (id),
    persona        VARCHAR(20)  NOT NULL,
    mode           VARCHAR(20)  NOT NULL,
    status         VARCHAR(20)  NOT NULL,
    summary        VARCHAR(255),
    started_at     TIMESTAMPTZ,
    ended_at       TIMESTAMPTZ,
    created_at     TIMESTAMPTZ  NOT NULL
);
-- 홈·통계(회원의 연습 면접 조회), 지원서 사용 여부(inUse)
CREATE INDEX ix_interview_sessions_user_ended ON interview_sessions (user_id, ended_at);
CREATE INDEX ix_interview_sessions_application ON interview_sessions (application_id);

CREATE TABLE interview_questions (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id BIGINT      NOT NULL REFERENCES interview_sessions (id),
    seq        INTEGER     NOT NULL,
    content    TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
-- 면접 안에서 질문 순서 중복 방지
CREATE UNIQUE INDEX uk_interview_questions_session_seq ON interview_questions (session_id, seq);

CREATE TABLE answers (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    question_id   BIGINT      NOT NULL REFERENCES interview_questions (id),
    input_type    VARCHAR(20) NOT NULL,
    content       TEXT        NOT NULL,
    score         INTEGER,
    good_point    TEXT,
    improve_point TEXT,
    created_at    TIMESTAMPTZ NOT NULL,
    -- 질문 하나에 답변 하나
    CONSTRAINT uk_answers_question UNIQUE (question_id)
);

CREATE TABLE recordings (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id     BIGINT       NOT NULL REFERENCES interview_sessions (id),
    answer_id      BIGINT       REFERENCES answers (id),
    recording_type VARCHAR(20)  NOT NULL,
    object_key     VARCHAR(500) NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL,
    CONSTRAINT uk_recordings_object_key UNIQUE (object_key)
);
CREATE INDEX ix_recordings_session ON recordings (session_id);

CREATE TABLE session_scores (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id BIGINT       NOT NULL REFERENCES interview_sessions (id),
    criterion  VARCHAR(20)  NOT NULL,
    score      INTEGER      NOT NULL,
    comment    VARCHAR(255),
    CONSTRAINT uk_session_scores_session_criterion UNIQUE (session_id, criterion)
);

-- 화상 면접 세션만 저장. 세션 하나에 하나
CREATE TABLE speech_metrics (
    session_id          BIGINT PRIMARY KEY REFERENCES interview_sessions (id),
    filler_per_min      NUMERIC(5, 2),
    long_pause_count    INTEGER,
    speed_deviation_pct NUMERIC(5, 2),
    trailing_off_ratio  NUMERIC(5, 2),
    pitch_range_st      NUMERIC(5, 2),
    gaze_ratio          NUMERIC(5, 2),
    created_at          TIMESTAMPTZ NOT NULL
);

CREATE TABLE practice_logs (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       BIGINT      NOT NULL REFERENCES users (id),
    practice_date DATE        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL,
    CONSTRAINT uk_practice_logs_user_date UNIQUE (user_id, practice_date)
);
