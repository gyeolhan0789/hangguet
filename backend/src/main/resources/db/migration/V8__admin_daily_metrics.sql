-- 8.16 관리자 일별 메트릭: 8.15 홈 집계를 하루에 한 행씩 남긴다(시계열)
-- 되돌리기(Rollback): DROP TABLE admin_daily_metrics; 뒤 flyway_schema_history에서 version '7' 행을 지운다.

-- 비율 대신 분자 · 분모를 남겨 기간으로 묶어 다시 계산할 수 있게 한다.
-- 날짜로 정해지는 값(가입 · 연습 · 재방문)은 metric_date 기준, 상태가 바뀌는 값(회원 · 면접 · 문의 · 유지권 수)은 기록한 시각(recorded_at) 기준이다
CREATE TABLE admin_daily_metrics (
    metric_date          DATE        PRIMARY KEY,
    users_total          INT         NOT NULL,
    users_joined         INT         NOT NULL,
    users_withdrawn      INT         NOT NULL,
    users_interviewed    INT         NOT NULL,
    practiced_users      INT         NOT NULL,
    practiced_week       INT         NOT NULL,
    d1_eligible          INT         NOT NULL,
    d1_returned          INT         NOT NULL,
    d3_eligible          INT         NOT NULL,
    d3_returned          INT         NOT NULL,
    d7_eligible          INT         NOT NULL,
    d7_returned          INT         NOT NULL,
    interviews_total     INT         NOT NULL,
    interviews_completed INT         NOT NULL,
    interviews_failed    INT         NOT NULL,
    interviews_aborted   INT         NOT NULL,
    interviews_stuck     INT         NOT NULL,
    applications         INT         NOT NULL,
    inquiries_waiting    INT         NOT NULL,
    freezes_granted      INT         NOT NULL,
    freezes_used         INT         NOT NULL,
    recorded_at          TIMESTAMPTZ NOT NULL
);
