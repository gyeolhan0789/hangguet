-- 카카오톡 연습 알림(API 명세 2.8 ~ 2.11). 카카오 회원이 고른 시각에 그날 연습하지 않았으면 "나에게 보내기"로 알린다.
-- 되돌리기(Rollback): 아래를 실행하고 flyway_schema_history에서 version '14' 행을 지운다. 저장한 카카오 토큰도 함께 사라진다.
--   DROP TABLE practice_alarms;

-- 회원마다 한 행. 알림 시각은 끈 뒤에도 남기고, 켜져 있을 때만 카카오 토큰이 있다.
-- 토큰은 문의와 같은 키로 암호화한다(AES-256-GCM, INQUIRY_ENCRYPTION_KEY)
CREATE TABLE practice_alarms (
    user_id                  BIGINT      PRIMARY KEY REFERENCES users (id),
    alarm_time               TIME        NOT NULL,
    kakao_access_token       TEXT,
    kakao_access_expires_at  TIMESTAMPTZ,
    kakao_refresh_token      TEXT,
    kakao_refresh_expires_at TIMESTAMPTZ,
    -- 마지막으로 보낸 날(한국 시간). 같은 날 두 번 보내지 않는다
    last_sent_on             DATE,
    created_at               TIMESTAMPTZ NOT NULL,
    updated_at               TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_practice_alarms_tokens CHECK (
        (kakao_access_token IS NULL) = (kakao_refresh_token IS NULL)
        AND (kakao_access_token IS NULL) = (kakao_access_expires_at IS NULL)
        AND (kakao_refresh_token IS NULL) = (kakao_refresh_expires_at IS NULL))
);
-- 매분 그 시각에 보낼 켜진 알림을 찾는다
CREATE INDEX ix_practice_alarms_time ON practice_alarms (alarm_time) WHERE kakao_refresh_token IS NOT NULL;
