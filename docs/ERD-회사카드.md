# 회사 카드 ERD

회사 카드 파이프라인이 만든 카드를 메인 DB에 넣고 AI 작업 메시지에 담는 설계다. API 명세 B-9의 "회사 요약 Table"에 해당한다.
마이그레이션 초안은 [ERD-회사카드.sql](ERD-회사카드.sql)이다(레포 Flyway 규칙: `BIGINT IDENTITY`·`TIMESTAMPTZ`·공통코드 없음).

## 정한 것 (2026-10-30)

| 항목 | 결정 | 이유 |
|---|---|---|
| 쓰는 곳 | AI 작업 메시지(PLAN·SCORE_ANSWER·EVALUATE)만. 사용자 화면에는 보여 주지 않는다 | |
| DB | 각 환경의 메인 DB(`a301`)에 테이블을 더한다. database를 따로 만들지 않는다 | 면접과 FK로 잇고, Flyway·백업(`pg_dump`)을 하나로 유지한다 |
| 적재 | **BE**가 S3의 카드를 읽어 넣는다 | DB에는 BE만 접속한다는 규칙을 지킨다(AI·파이프라인은 DB에 접속하지 않음) |
| 변경 감지 | BE 스케줄러가 1시간마다 `manifest.json`을 본다. SQS를 쓰지 않는다 | 카드는 하루 한 번 바뀐다. 큐·이벤트 설정 없이 S3 요청 몇 번으로 끝난다 |
| 저장 형태 | 카드 JSON을 `company_cards.card`(JSONB)에 그대로 둔다. 항목·출처 테이블로 나누지 않는다 | 항목별로 조회할 곳이 없다. BE가 카드 형식을 몰라도 되어 형식이 바뀌어도 BE를 고치지 않는다 |
| AI 전달 | 카드 JSON을 그대로 `companyCard`에 담는다 | 항목마다 원문 인용·출처가 붙어 있어 AI가 근거로 쓰기 좋다 |
| 회사 매칭 | 면접을 만들 때 지원서 회사명을 별칭에서 한 번 찾고, 그때의 최신 카드를 면접에 저장한다 | 지원서를 바꾸지 않는다. 지원서를 쓴 뒤 카드가 생긴 회사도 다음 면접부터 붙는다 |
| 면접 안 일관성 | SCORE_ANSWER·EVALUATE는 면접에 저장된 카드를 쓴다 | 면접 도중 매일 갱신(13:00)이 끼어도 한 면접은 같은 카드를 본다 |
| 보관 | 내용(해시)이 바뀔 때만 새 카드. 최신이 아니고, 어느 면접도 쓰지 않고, 30일 지난 카드는 지운다 | 카드는 파이프라인이 다시 만들 수 있어 소프트 삭제를 쓰지 않는다 |
| S3 | 회사 카드 전용 버킷 하나를 개발·운영이 같이 읽는다. 원문·기사는 파이프라인 MinIO에 그대로 둔다 | 운영 버킷에 두면 개발 키에 운영 권한을 줘야 하고, 운영 버킷 IP 조건에 개발 서버가 막힌다 |

## 흐름

```
[파이프라인 EC2, Airflow]
  매일 13:00 최근 이슈 갱신 / ▶ 카드 전체 생성
  → 원문·기사: MinIO (지금 그대로)
  → publish_cards: 공용 버킷에 cards/{고유번호}/{sha256}.json → 마지막에 manifest.json

[개발 BE · 운영 BE, 각자] 1시간마다
  manifest.json → 처음 보는 run_id면 회사·별칭 맞추기, 해시가 바뀐 카드만 넣기 → 지난 카드 정리 → run_id 기록

[면접]
  면접 생성: 지원서 회사명 → 별칭 → 최신 카드 id를 interview_sessions.company_card_id에 저장(못 찾으면 NULL)
  PLAN · SCORE_ANSWER · EVALUATE 메시지: company_card_id의 카드를 companyCard에 그대로 담음(NULL이면 뺌)
```

## 파이프라인이 올리는 것

[company-pipeline README의 카드 올리기](../company-pipeline/pipeline/README.md#카드-올리기-) 참고. BE가 기대는 약속만 적는다.

- `manifest.json`: `format`(지금 1), `run_id`(실행 시각, 실행마다 다름), `companies[]`
  - `companies[]`: `corp_code`, `name`, `is_listed`, `aliases[]`(정규화한 이름), `generated_at`, `card_key`, `sha256`
  - 카드를 모두 올린 뒤 마지막에 쓴다. `card_key`가 가리키는 파일은 내용이 바뀌면 키도 바뀌어 덮어쓰이지 않는다
- 카드 JSON: [카드 형식](../company-pipeline/pipeline/README.md#카드-형식). BE는 내용을 해석하지 않는다
  - 출처는 항목마다 붙어 있고, 사업보고서·인재상 페이지 정보는 `report`·`talent_page`에 있다. 2026-10-30 이전 카드에는 이 두 칸이 없을 수 있다
- `format`이 BE가 아는 값이 아니면 BE는 적재하지 않고 오류 로그를 남긴다

## 테이블

### 회사 `companies`

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| id | BIGINT IDENTITY | NOT NULL | PK |
| corp_code | VARCHAR(8) | NOT NULL | DART 고유번호. 중복 불가. manifest의 회사를 찾는 기준 |
| name | VARCHAR(100) | NOT NULL | DART 등록 회사명 |
| is_listed | BOOLEAN | NOT NULL | 상장 여부 |
| created_at · updated_at | TIMESTAMPTZ | NOT NULL | |

### 회사별칭 `company_aliases`

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| id | BIGINT IDENTITY | NOT NULL | PK |
| company_id | BIGINT | NOT NULL | 회사 FK |
| alias | VARCHAR(100) | NOT NULL | 정규화한 이름(아래 규칙). 중복 불가 |
| created_at | TIMESTAMPTZ | NOT NULL | |

- 적재 때마다 manifest의 `aliases`에 맞춘다(없어진 별칭은 지우고 새 별칭은 넣는다)
- 다른 회사가 이미 쓰는 별칭이면 넣지 않고 경고 로그만 남긴다(먼저 들어온 회사가 가진다)

### 회사카드 `company_cards`

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| id | BIGINT IDENTITY | NOT NULL | PK |
| company_id | BIGINT | NOT NULL | 회사 FK |
| card | JSONB | NOT NULL | 카드 JSON 그대로 |
| content_hash | CHAR(64) | NOT NULL | 카드 파일의 sha256(manifest 값). 같으면 새로 넣지 않는다 |
| generated_at | DATE | NOT NULL | 파이프라인이 카드를 만든 날 |
| is_current | BOOLEAN | NOT NULL | 회사당 하나만 참(부분 유니크 인덱스) |
| created_at | TIMESTAMPTZ | NOT NULL | 적재한 시각. 보관 기간 기준 |

### 카드적재기록 `company_card_imports`

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| run_id | VARCHAR(50) | NOT NULL | PK. manifest의 `run_id` |
| imported_at | TIMESTAMPTZ | NOT NULL | 적재를 마친 시각 |

### 면접 `interview_sessions`에 더하는 컬럼

| 컬럼 | 타입 | NULL | 설명 |
|---|---|---|---|
| company_card_id | BIGINT | NULL | 회사카드 FK. 면접을 만들 때 정한다. 회사를 못 찾았거나 카드가 없으면 NULL |

## BE 적재 규칙

1. `manifest.json`을 읽는다. `run_id`가 `company_card_imports`에 있으면 끝
2. 회사마다(회사 하나씩 트랜잭션)
   - `companies`를 `corp_code`로 넣거나 고친다(`name`, `is_listed`)
   - `company_aliases`를 `aliases`에 맞춘다
   - 지금 카드의 `content_hash`가 `sha256`과 같으면 넘어간다. 다르면 `card_key`를 읽어 내용의 sha256이 manifest 값과 같은지 확인하고, 이전 카드를 `is_current = false`로 바꾼 뒤 새 카드를 넣는다
3. 지난 카드 정리: `is_current = false`이고, `interview_sessions.company_card_id`가 가리키지 않고, `created_at`이 30일 지난 카드를 지운다
4. 모든 회사가 성공했을 때만 `run_id`를 기록한다. 실패한 회사가 있으면 기록하지 않아 다음 주기에 다시 한다(이미 넣은 회사는 해시가 같아 넘어간다)

- manifest에서 빠진 회사(파이프라인 목록에서 뺀 회사)는 건드리지 않는다
- 개발·운영은 같은 manifest를 각자 적재한다. `run_id` 기록도 각자 DB에 있다
- 스케줄: `@Scheduled(cron = "0 0 * * * *", zone = KoreaTime.ZONE_ID)` 정도. BE 인스턴스가 하나라 중복 실행을 막지 않는다(겹쳐도 해시·`run_id` 때문에 결과는 같다)

## 회사 매칭 규칙

지원서 회사명(`applications.company_name`)을 아래처럼 맞춘 뒤 `company_aliases.alias`와 같은 행을 찾는다. 파이프라인 `candidates.key`와 같은 규칙이다.

- 지울 것(대소문자 무시): `(주)`, `㈜`, `주식회사`, `Co., Ltd`류(`co\.?,?\.?\s*ltd\.?`), `Corp`·`Corporation`, `Inc`, 공백, `.` `,` `·` `-`
- 남은 글자를 소문자로(`Locale.ROOT`)
- 예: `삼성 SDS` → `삼성sds`, `(주)카카오` → `카카오`, `Samsung SDS Co., Ltd.` → `samsungsds`

## AI 작업 메시지

- PLAN·SCORE_ANSWER·EVALUATE에 `companyCard`(카드 JSON 그대로)를 더한다. 면접의 `company_card_id`가 NULL이면 필드를 넣지 않는다
- 크기: 2026-10-30 카드 110개 평균 약 4KB, 가장 큰 것 9KB
- AI 명세 8장(요약 한 덩어리 + 출처 목록)과 2·3·4장 입력을 이 형식으로 고친다. AI 담당과 맞춘 뒤 고친다 **[합의 필요]**

## 인프라

| 항목 | 내용 |
|---|---|
| 버킷 | 회사 카드 전용 1개(이름 예: `hanggeut-a301-company`). 퍼블릭 차단, SSE-S3, IP 조건 없음(개발 서버·파이프라인 EC2도 읽고 씀) |
| 수명 주기 | `cards/` 30일 지나면 삭제. 파이프라인이 지금 카드를 매일 다시 올려 지금 카드는 남는다 |
| 쓰기 | IAM `a301-company-pipeline`: 이 버킷 `PutObject`·`GetObject`·`ListBucket`. 파이프라인 EC2 `.env`의 `CARD_AWS_*` |
| 읽기 | 기존 `a301-prod-app`·`a301-dev-app`에 이 버킷 `GetObject`·`ListBucket` 추가 |
| BE 설정 | `COMPANY_S3_BUCKET`(개발·운영 같은 값) |

## 정할 것

1. AI 명세에 `companyCard` 반영(필드 이름, 기존 `companySummary` 정리) **[합의 필요]**
2. 버킷 이름
3. 매칭 결과를 화면·관리자에서 볼 필요가 있는지(지금은 로그만)
