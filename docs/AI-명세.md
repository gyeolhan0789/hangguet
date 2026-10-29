# A301 AI 명세

> AI 서버(면접 에이전트, 분석 작업자)의 처리 계약이다. 화면이 보는 API와 면접방 메시지의 동작은 [API 명세](API-명세.md)와 Swagger에, 서버 구성(LiveKit · 컨테이너 · Redis)은 [운영 배포 계획](../이해준/deploy_plan/README.md)에 두고, 이 문서에는 AI가 무엇을 받아 무엇을 돌려주는지와 실패 처리를 적는다.
>
> 표기: **[결정]** 정한 것 · **[제안]** 이 문서가 제안하는 것(합의 전) · **[미정]** 정하지 않은 것

## 목차

1. [구성](#1-구성)
2. [PLAN: 질문·채점 기준 만들기](#2-plan-질문채점-기준-만들기)
3. [SCORE_ANSWER: 답변 채점](#3-score_answer-답변-채점)
4. [EVALUATE: 결과 만들기](#4-evaluate-결과-만들기)
5. [실패 처리](#5-실패-처리)
6. [면접 에이전트](#6-면접-에이전트)
7. [MERGE_RECORDING: 녹화 합치기](#7-merge_recording-녹화-합치기)
8. [회사 공시 요약 (고도화)](#8-회사-공시-요약-고도화)
9. [버전](#9-버전)
10. [확인 필요](#10-확인-필요)

## 1. 구성

```
브라우저 ─ BE(Spring)                     모든 API (API 명세)
브라우저 ⇄ LiveKit 면접방 ⇄ AI 면접 에이전트  음성 · 면접방 메시지 (6장)
                              └─▶ Soniox(STT) · ElevenLabs(TTS) · Jev

BE ─ Redis 작업 큐 3개(1.3) ─▶ AI 분석 작업자 ─▶ GMS · ffmpeg   PLAN · SCORE_ANSWER · EVALUATE · MERGE_RECORDING
BE ◀─ Redis 결과 큐 ai:results ─ AI 분석 작업자 · AI 면접 에이전트
BE ─ LiveKit 서버 API ─▶ 에이전트 배정(질문 5개 · 채점 기준) · 방 삭제 · Egress 녹화
```

- **AI는 DB에 접속하지 않는다** **[결정]**(읽기 · 쓰기 모두). 입력은 BE가 작업 메시지(1.3)와 에이전트 배정 정보(6.1)에 담아 보내고, 출력은 결과 메시지(1.4)로 돌려준다. BE가 받아 검증한 뒤 DB와 Redis 진행 상태에 쓴다
  - 왜: 스키마는 BE의 Flyway가 관리한다. AI가 같은 테이블을 직접 다루면 마이그레이션 때마다 두 파트가 함께 고쳐야 하고, 면접 상태 규칙이 두 곳에 생긴다. AI와 BE 사이 계약을 메시지 형식 하나로 둔다
- BE와 AI는 서로 HTTP로 부르지 않는다. Redis 큐와 LiveKit만 거친다. BE는 DB 커밋과 함께 Outbox로 작업을 큐에 넣는다(CONTRIBUTING 6.2)
- 외부 서비스: GMS(LLM, 분석 작업자), Jev(면접관 반응), Soniox(STT), ElevenLabs(TTS). 모두 AI 서버에서만 부르고 키도 AI 서버에만 있다. 면접 중에는 GMS를 부르지 않는다(질문 5개를 미리 만들고 꼬리질문은 MVP 범위 밖)
- 평가 항목은 `JOB_FIT`(직무 적합성)·`COVER_LETTER`(자소서 검증)·`LOGIC`(논리성)·`DELIVERY`(전달력) 4개이고, 판정은 3단계(좋아요·보통·아쉬워요)다

### 1.1 주체별 입력과 출력

| 주체 | 시작 | 입력 | 출력(결과 메시지) | BE가 저장하는 곳 |
|---|---|---|---|---|
| 자기소개서 검증 | 4.1(API 명세) | 검증 큐 `ai:checks` | 작업별 결과 키(2.1) | 없음(BE가 저장 요청 안에서 받음) |
| PLAN | 5.1·5.3 | 작업 메시지 | `plan.progress` · `plan.completed` · `plan.failed` | `interview_plans`, Redis `planStatus`·`planProgress` |
| SCORE_ANSWER | 답변 저장 직후 | 작업 메시지 | `answer.scored` | `answers.evaluation` |
| EVALUATE | 5.8(답변 ≥1)·5.9 | 작업 메시지 | `evaluation.progress` · `evaluation.completed` · `evaluation.failed` | `answers`의 `score`·`good_point`·`improve_point`·`evaluation`, `session_scores`, `speech_metrics`, `interview_sessions`의 `status`·`summary`, Redis `analysisStep` |
| MERGE_RECORDING | 5.8(화상) | 작업 메시지 | `recording.merged` · `recording.mergeFailed` | `recordings` |
| 면접 에이전트 | 5.4 배정 | 배정 정보, 면접방 음성 · 메시지 | `question.started` · `answer.completed` · `assignment.rejected` | `interview_questions`, `answers`(화상, `speech` 포함), `interview_sessions`의 `status` |

`interview_plans`(`claims`·`questions`), `answers.tokens`, `answers.evaluation`은 DB 스키마(BE 마이그레이션 V2)에 JSONB로 있다. 형식은 이 문서 2·3장을 따른다. 에이전트가 계산한 음성 지표(`answer.completed`의 `speech`, 6.2)를 저장할 `answers.speech`(JSONB)와 `answerStartedAt`을 저장할 `answers.started_at`은 BE 마이그레이션 V4로 추가했다. 이 값은 실시간 음성으로만 계산하므로 채점이 실패해도 결과 생성(4장)에서 사용할 수 있도록 답변과 함께 저장한다.

### 1.2 Redis 진행 상태

- 키는 Redis Hash `session:{sessionId}:runtime`이고 **BE만 쓴다** **[결정]**. AI는 진행 상태를 결과 메시지(`plan.progress`·`evaluation.progress`)로 보내고, BE가 `planStatus`·`planProgress`·`analysisStep`에 쓴다
- Redis 값이 없으면 `interview_plans` 행이 있을 때 `planStatus`를 `READY`로 본다(BE)

### 1.3 작업 메시지 (BE → AI)

- 큐는 작업 종류별 Redis List 3개다. BE가 `jobType`에 맞는 큐에 `LPUSH`하고, 작업자는 `BLMOVE {큐} {처리 중 리스트} RIGHT LEFT`로 꺼내 처리한 뒤 처리 중 리스트에서 지운다(작업자가 멈춰도 메시지가 남음)

  | 큐 | 처리 중 리스트 | 작업 | 작업자(`AI_WORKER_QUEUE`) |
  |---|---|---|---|
  | `ai:jobs:plan` | `ai:jobs:plan:processing` | PLAN | `plan` |
  | `ai:jobs:recording` | `ai:jobs:recording:processing` | MERGE_RECORDING | `recording` |
  | `ai:jobs` | `ai:jobs:processing` | SCORE_ANSWER · EVALUATE | `default`(기본값) |

- 작업자는 작업을 하나씩 처리하므로, 큐가 하나이면 녹화 합치기·결과 생성이 몰릴 때 사용자가 기다리는 PLAN이 최대 대기 시간(5장)을 넘긴다. 그래서 PLAN과 MERGE_RECORDING을 별도 큐로 나눈다
- 큐마다 작업자를 1대 둔다. 작업자는 시작할 때 자기 처리 중 리스트에 남은 작업만 자기 큐로 되돌리므로, 큐마다 처리 중 리스트가 달라야 다른 작업자가 처리 중인 작업을 되돌리지 않는다
- `default` 작업자는 모든 작업의 처리 함수를 등록한다. 자기소개서 검증 전용 큐(`ai:checks`, 2.1)도 `default` 작업자가 받는다. 큐를 나누기 전에 `ai:jobs`에 들어간 PLAN·MERGE_RECORDING도 처리하기 위함이다
- 공통 필드: `jobType`(`PLAN` · `SCORE_ANSWER` · `EVALUATE` · `MERGE_RECORDING`), `jobId`(UUID 문자열), `sessionId`, `requestedAt`(BE가 작업을 요청한 시각, ISO 8601). BE와 AI는 PLAN·EVALUATE의 최대 대기 시간(5장)을 모두 이 값부터 계산한다
- AI가 DB를 읽지 않으므로 **작업에 필요한 내용을 모두 메시지에 담는다** **[제안]**. 작업별 필드는 2·3·4·7장
- BE는 Outbox로 보내므로 같은 메시지가 두 번 올 수 있다. AI는 같은 작업을 두 번 처리해도 되고, 중복 결과는 BE가 거른다(1.4)
- 형식이 틀린 작업(필수 필드 누락, 형식·범위 불일치)은 다시 처리해도 결과가 같으므로 재시도하지 않는다
  - `jobType`·`jobId`·`sessionId`를 해석할 수 있으면 그 작업의 실패 결과(`plan.failed`·`evaluation.failed`·`recording.mergeFailed`)를 `reason: INVALID_JOB`으로 즉시 전송한다. 화면이 BE 최대 대기 시간까지 기다리지 않고 다시 시도로 넘어가게 하기 위해서다
  - SCORE_ANSWER는 실패 결과 종류가 없으므로 결과를 전송하지 않는다(EVALUATE가 마저 채점)
  - 세 필드 중 하나라도 해석할 수 없으면 결과 없이 폐기하고 로그를 남긴다
- 명세에 없는 필드는 무시한다. 고도화에서 필드가 추가돼도 배포 순서와 관계없이 처리하기 위해서다
- PLAN·EVALUATE 작업과 자기소개서 검증(2.1) 메시지에 `coverLetterItems`가 없고 이전 BE의 `coverLetter`(글 하나)가 있으면 질문 '자기소개서'인 1번 문항으로 읽는다. 배포 중 큐에 남은 이전 메시지를 처리하기 위한 것으로, 다음 배포에서 지운다

```json
{ "jobType": "SCORE_ANSWER", "jobId": "8f0c…", "sessionId": 55, "requestedAt": "2026-10-22T14:03:13+09:00", "answerId": 903,
  "mode": "VIDEO", "seq": 3,
  "question": "응답 시간을 40% 줄인 과정은?", "criteria": "원인 분석 · 수치 근거",
  "content": "조회 쿼리 실행 계획을 보고…", "tokens": [ { "text": "조회", "startMs": 0, "endMs": 280 } ],
  "speech": { "trailingOffRatio": 12.5, "pitchRangeSt": 6.2 } }
```

### 1.4 결과 메시지 (AI → BE) **[제안]**

- 큐는 Redis List `ai:results`다. AI가 `LPUSH`하고, BE는 `BLMOVE ai:results ai:results:processing RIGHT LEFT`로 꺼내 저장한 뒤 처리 중 리스트에서 지운다(BE가 멈춰도 메시지가 남음)
- BE가 저장할 수 없는 메시지(JSON 아님, 모르는 `type`, 필수 필드 없음, 질문이 5개가 아님 등)는 `ai:results:failed`에 원문 그대로 모아 둔다. 결과가 반영되지 않으면 여기를 확인한다
- 공통 필드: `type`, `sessionId`, `jobId`(작업에서 나온 결과만. 받은 작업의 `jobId`를 그대로 담는다), `occurredAt`(ISO 8601)

| `type` | 보내는 쪽 | 내용 | BE가 하는 일 |
|---|---|---|---|
| `plan.progress` | 분석 작업자 | `progress`(50 등) | `planProgress` |
| `plan.completed` | 분석 작업자 | `claims`, `questions`, `promptVersion`, `modelVersion`(2장) | `interview_plans` 저장, `planStatus: READY` |
| `plan.failed` | 분석 작업자 | `reason`(아래 실패 이유) | `planStatus: FAILED` |
| `answer.scored` | 분석 작업자 | `answerId`, `evaluation`(3장) | `answers.evaluation`이 비어 있을 때만 저장 |
| `evaluation.progress` | 분석 작업자 | `analysisStep` | `analysisStep` |
| `evaluation.completed` | 분석 작업자 | 4장(`headline`·`summary` 포함) | 한 트랜잭션으로 저장, `COMPLETED`, `analysisStep` 비움 |
| `evaluation.failed` | 분석 작업자 | `reason`(아래 실패 이유) | `FAILED` |
| `recording.merged` | 분석 작업자 | `objectKey`(합친 mp4) | `recordings` 저장 |
| `recording.mergeFailed` | 분석 작업자 | `reason`(아래 실패 이유) | BE는 다시보기에서 `videoStatus: FAILED`로 응답한다(API 명세 6.4) |
| `question.started` | 면접 에이전트 | `seq`, `startedAt`(6.2) | `interview_questions` 생성(`created_at` = `startedAt`) |
| `answer.completed` | 면접 에이전트 | `seq`, `answerStartedAt`, `content`, `tokens`, `speech`, `endReason`(6.2) | `answers` 저장(`speech`는 `answers.speech`), SCORE_ANSWER 작업 등록 |
| `assignment.rejected` | 면접 에이전트 | `reason`(아래 실패 이유의 `INVALID_ASSIGNMENT`·`CAPACITY_EXCEEDED`) | 면접이 `IN_PROGRESS`이고 질문 행이 없을 때만 면접방을 닫고 `START_FAILED`로 변경한다. 그 밖에는 폐기한다 |

**실패 이유(`reason`)** 실패 결과 메시지는 아래 값 중 하나를 담는다. BE가 값으로 처리를 나눌 수 있도록 자유 문장을 사용하지 않는다.

| 값 | 결과 메시지 | 뜻 |
|---|---|---|
| `GMS_UNAVAILABLE` | `plan.failed` · `evaluation.failed` | GMS 호출이 재시도 후에도 실패했거나 재시도 대상이 아닌 오류 응답을 수신함(5장) |
| `INVALID_OUTPUT` | `plan.failed` · `evaluation.failed` | GMS 출력이 재시도 후에도 검증을 통과하지 못함(2·5장) |
| `TIMED_OUT` | `plan.failed` · `evaluation.failed` | BE 최대 대기 시간을 넘음(5장) |
| `TRACK_NOT_FOUND` | `recording.mergeFailed` | 원본 위치에 트랙 파일이 없음(7장) |
| `STORAGE_ERROR` | `recording.mergeFailed` | 녹화 저장소에서 다운로드하거나 업로드하지 못함 |
| `MERGE_ERROR` | `recording.mergeFailed` | ffmpeg가 트랙을 합치지 못함 |
| `INVALID_JOB` | 세 작업 실패 메시지 모두 | 작업 메시지 형식이 틀림(1.3) |
| `INVALID_ASSIGNMENT` | `assignment.rejected` | 배정 정보 형식이 틀림(6.1) |
| `CAPACITY_EXCEEDED` | `assignment.rejected` | 동시 면접 상한을 넘음(6.5) |
| `INTERNAL_ERROR` | 세 작업 실패 메시지 모두 | 그 밖의 예상하지 못한 오류. 원인은 작업자 로그에 남김 |

**중복 · 늦은 결과는 BE가 거른다**

| 경우 | 예 | 처리 |
|---|---|---|
| 중복 수신 | 같은 `answer.completed`가 두 번 | 「질문 하나에 답변 하나」(`answers.question_id` UNIQUE)로 두 번째는 버림 |
| 중복 수신 | 같은 `answer.scored`가 두 번 | `evaluation`이 이미 있어 버림 |
| 중복 · 순서 역전 | 같은 `assignment.rejected`가 두 번, 질문을 시작한 뒤 도착, 또는 다시 시작(5.4)한 뒤 이전 시도의 거절이 도착 | 면접이 이미 `START_FAILED`이거나 질문 행이 있거나 `occurredAt`이 면접 시작 시각보다 이르면 폐기 |
| 순서 역전 | 5.3 재생성 뒤 실패했던 이전 PLAN의 결과가 늦게 도착 | `planStatus`가 `GENERATING`이 아니거나 `interview_plans` 행이 이미 있으면 버림 |
| 순서 역전 | 5.9 재생성 뒤 이전 EVALUATE 결과가 늦게 도착 | `status`가 `ANALYZING`이 아니면 버림. 같은 `ANALYZING` 안에서 이전 시도와 구분하려면 BE가 마지막으로 보낸 `jobId`와 비교한다 **[제안]** |

## 2. PLAN: 질문·채점 기준 만들기

면접 전에 자소서에서 주장을 뽑고, 그 주장을 파고드는 질문 5개와 질문마다 채점 기준 1개를 만든다.

- **시작** 5.1·5.3
- **입력(작업 메시지)** `companyName`, `jobTitle`, `coverLetterItems`(자기소개서 문항 1~5개를 문항 순서대로, 문항마다 `question`·`answer`. API 명세 4.1) **[제안]**. 고도화에서는 회사 공시 요약(8장)을 더한다
- **STEP 01 주장 추출(GMS)** 자소서에서 경험·수치를 뽑는다. `sentenceNo`는 자소서의 문장 순번(1부터)이다. 문항 순서대로 문항 질문과 답변을 같은 규칙으로 나눠 이어서 센다(질문은 보통 한 문장). V13 전에 만든 플랜은 문항으로 옮기기 전 자기소개서 글 하나로 셌다. 옮기며 1번 문항에 붙은 질문 줄('자기소개서')이 없으므로 지금 문항 기준 번호와 그 줄만큼 어긋난다
  - 문장은 비어 있지 않은 줄마다 나누고, 줄 안에서는 한글·영문·닫는 괄호·%·따옴표 바로 뒤의 마침표·물음표·느낌표(그 뒤에 닫는 따옴표·괄호가 붙을 수 있음) 다음 공백에서 나눈다
  - 숫자 뒤 마침표(「1. 지원 동기」 같은 번호)에서는 나누지 않는다
- **STEP 02 질문·기준 생성(GMS)** 주장마다 파고드는 질문과 채점 기준을 JSON으로 생성한다. 질문 수 5개가 우선이다. 주장이 5개보다 적으면 같은 주장을 다른 관점으로 질문하고, 많으면 검증 가치가 큰 주장을 선택한다

```json
{
  "claims": [
    { "id": "c1", "text": "조회 응답 시간을 40% 줄였다", "type": "NUMBER", "sentenceNo": 4 }
  ],
  "questions": [
    { "seq": 1, "content": "응답 시간을 40% 줄인 과정은?", "criteria": "원인 분석 · 수치 근거", "claimId": "c1" }
  ]
}
```

- `type`: `EXPERIENCE`(경험) · `NUMBER`(수치). `questions`는 `seq` 1~5로 정확히 5개
- **검증** JSON이 아니거나 질문이 5개가 아니면 1회 재시도 후 `plan.failed`. `claimId`가 없는 주장을 가리키면 그 질문만 1회 다시 만들고, 그래도 틀리면 `plan.failed`
- **근거 검사** 주장의 수량 표현마다 같은 값이 그 주장의 근거 문장(`sentenceNo`)에 있을 때만 주장을 유지한다. 근거 문장에 없는 수치를 전제로 질문하지 않기 위해서다
  - 숫자는 값으로 비교한다(6.0과 6, 1,100과 1100은 같음). 단위는 비교하지 않는다
  - 숫자 없는 수량 표현(「절반」, 「두 배」, 「3분의 1」 등)도 같은 값으로 인정한다(「절반」 = 50%, 「두 배」 = 200%). 주장이 「50%」이고 원문이 「절반」인 경우도 같다
  - 남는 주장이 없으면 출력 구조 깨짐과 같이 처리한다(5장)
- **진행률** STEP 01이 끝나면 `plan.progress`(50), STEP 02가 끝나면 `plan.completed`
- **결과** `plan.completed`에 위 JSON과 `promptVersion`·`modelVersion`을 담는다. `modelVersion`은 GMS 응답에 실린 모델 이름이다(9장). BE가 `interview_plans(session_id PK·FK, claims, questions, prompt_version, model_version, created_at)`에 저장한다
- **질문 출제** 질문 5개와 채점 기준은 BE가 5.4에서 면접 에이전트 배정 정보로 넘긴다(6.1). `interview_questions` 행은 에이전트가 질문을 말하기 시작할 때(`question.started`) BE가 만든다. 질문 수는 5개 고정이다

### 2.1 자기소개서 검증

지원서를 저장하기 전(API 명세 4.1)에 자기소개서로 면접 질문을 만들 수 있는지 Jev로 판단한다. 의미 없는 글이거나 내용이 부족한 자기소개서로 면접을 시작해 면접방에서 질문 생성이 실패하지 않게 하기 위해서다.

- **큐** BE가 지원서 저장 요청 안에서 결과를 기다리므로 작업 큐(`ai:jobs`)·Outbox·결과 큐(`ai:results`)를 쓰지 않는다. 분석 작업자가 전용 큐를 별도 스레드로 받아, 질문 생성·녹화 합치기 작업 뒤에 줄 서지 않는다
  - BE가 `ai:checks`에 `LPUSH`하고, 작업자는 꺼내 판단한 뒤 결과를 `ai:checks:result:{jobId}`에 `LPUSH`한다(60초 뒤 만료). BE는 그 키를 `BRPOP`으로 최대 8초(임시 값) 기다린다
  - 작업자는 `requestedAt`부터 8초가 지난 작업은 판단하지 않고 버린다. BE가 이미 기다리기를 그만뒀기 때문이다
  - 처리 중에 작업자가 멈추면 그 검증은 버려진다. BE는 시간 초과로 응답하고 화면이 다시 시도하게 한다

```json
{ "jobId": "c0f1…", "requestedAt": "2026-10-27T14:03:13+09:00",
  "companyName": "○○전자", "jobTitle": "백엔드 개발자",
  "coverLetterItems": [ { "question": "지원 동기", "answer": "저는…" } ] }
```

- **판단(Jev)** 회사명·직무·자기소개서 문항(`coverLetterItems`, 받은 모양 그대로)을 `state`로 보내고 `noul` 질문 하나를 묻는다: 의미 있는 문장이고, 지원 동기나 경험을 묻는 질문을 여러 개 만들 만큼 구체적인 내용이 있는가. 글자 수 기준은 따로 두지 않고 이 질문으로 함께 판단한다. 0.5 이상(임시 값)이면 통과. 모델은 6.4와 같은 `jev-1.14.0`, 프롬프트 버전은 `cover-letter-check-v2`(9장. v1은 자기소개서를 글 하나 `coverLetter`로 받던 버전)
  - 제한 시간 5초(임시 값), 재시도하지 않는다. BE가 기다리는 시간 안에 결과를 돌려줘야 하기 때문이다
  - 요청에 자기소개서가 담기므로 본문을 로그에 남기지 않는다
- **결과** `{ "usable": true }` 또는 `{ "usable": false }`. 판단하지 못하면(Jev 장애·시간 초과·응답 형식 오류, `JEV_API_KEY` 없음, 메시지 형식 오류(문항이 1~5개가 아니거나 빈 질문·답변 포함)) `{ "error": "CHECK_FAILED" }`
- **BE 응답** `usable: false`는 400 `VALIDATION_FAILED`(`coverLetterItems`), `CHECK_FAILED`·시간 초과·Redis 장애는 503 `COVER_LETTER_CHECK_UNAVAILABLE`. 둘 다 저장하지 않는다

## 3. SCORE_ANSWER: 답변 채점

면접 중 답변마다 말하기 분석과 평가 STEP 01(기준별 판정)을 미리 한다. 다음 질문을 막지 않고, 실패해도 면접은 계속된다(EVALUATE가 마저 채점).

- **시작** BE가 답변을 저장한 직후(화상은 `answer.completed`, 채팅은 5.7). `answers.evaluation`이 비어 있을 때만 작업을 넣는다
- **입력(작업 메시지)** `answerId`, `mode`, `seq`, `question`, `criteria`, `content`, `tokens`(화상), `speech`(화상, `answers.speech`) **[제안]**. 고도화에서는 회사 공시 요약을 더한다
- **말하기 분석(화상만)** 입력은 `tokens`와 작업 메시지의 `speech`
  - 말하기 지표는 답변마다 구하는 5개(군말·긴 멈춤·말 속도·말끝 흐림·억양 폭, API 명세 6.3 `speechMetrics`에서 `gazeRatio`를 제외한 것)다. 시선 비율은 계산하지 않는다(API 명세 6.3)
  - `tokens`의 글자를 이어 붙인 뒤 공백을 경계로 단어로 묶는다. 단어 시각은 첫 토큰의 `startMs`부터 마지막 토큰의 `endMs`까지다
  - `tokens`로 군말 수·말한 시간·긴 멈춤 수·말 속도를 구한다
  - 말끝 흐림·억양 폭은 면접 에이전트가 답변을 듣는 동안 실시간 음성으로 계산해 `answer.completed`로 전송한 값(6.2)을 그대로 사용한다. 답변 음성 파일은 사용하지 않는다
  - `tokens`가 없거나 구하지 못한 지표는 비워 둔다

| 지표(`speech` 키) | 계산 |
|---|---|
| 군말 수 `fillerCount` | 단어에서 문장부호를 뺀 글이 망설임 소리(음·어·아·에·으·흠, 같은 글자를 늘인 "음음"·"어어" 포함)면 센다. 담화 표지(그·저·이제·뭐·막·약간·좀·그냥·그러니까·이렇게·뭔가)는 단어 끝에 쉼표·마침표·말줄임표가 붙어 혼자 끊길 때만 센다("그 사람"의 "그"는 세지 않는다) |
| 긴 멈춤 수 `longPauseCount` | 문장 중간에서 앞 단어 끝부터 다음 단어 시작까지 2초 이상 쉰 횟수. 앞 단어가 문장 끝([API 명세 면접방 메시지](API-명세.md#면접방-메시지-livekit)의 종결어미 기준)이면 문장 사이 쉼이라 세지 않는다. 화상 답변 끝 판단(7초)과는 다른 기준이다 |
| 말한 시간 `speakingMs` | 첫 단어 시작부터 마지막 단어 끝까지에서 긴 멈춤 시간을 뺀 값(밀리초) |
| 말 속도 `syllablesPerMin` | 한글 음절 수 ÷ 말한 분(정수로 반올림). 영문·숫자는 세지 않는다. 말한 시간이 0이면 비워 둔다 |
| 말끝 흐림 비율 `trailingOffRatio` | (에이전트) 문장마다 마지막 어절 구간의 평균 음량이 그 문장 발화 구간의 평균 음량보다 6dB 이상 낮으면 흐린 문장으로 집계한다. 흐린 문장 수 ÷ 문장 수 × 100(%, 소수 둘째 자리). 문장 경계는 긴 멈춤과 같은 종결어미 기준이고, 종결어미 없이 끝난 마지막 부분도 한 문장으로 본다 |
| 억양 폭 `pitchRangeSt` | (에이전트) 발화 구간에서 구한 음 높이(기본 주파수)의 하위 5% 값과 상위 95% 값으로 12 × log2(상위 ÷ 하위)를 계산한다(반음, 소수 둘째 자리) |

군말 목록과 2초는 로컬 실측(조용한 곳에서 망설임 소리·담화 표지가 모두 전사됨) 결과와 한국어 구어의 군말·쉼 쓰임을 근거로 정한 초안이다. 면접 단위 집계는 4장 `speech_metrics` 집계를 따른다.

- **판정 입력** 질문, 채점 기준, 답변 글. 화상은 `DELIVERY` 판정에 그 답변의 말하기 지표를 더한다
- **판정** 채점 기준을 잣대로 평가 항목 4개를 3단계로 판정한다(G-Eval)
  - 항목마다 판정 이유와 3단계(`level` 1 아쉬워요 · 2 보통 · 3 좋아요)를 받는다
  - 점수는 3단계(50·70·90)의 확률로 낸 기대값이다(`PROBABILITY`). 확률을 받지 못하면 판정한 단계의 점수를 그대로 쓴다(`FIXED`). 정수로 반올림한다
  - 점수 계산 방식은 `evaluation.criteria`의 항목마다 `scoreMethod`로 기록한다. 해당 항목의 점수를 확률 기대값으로 계산했으면 `PROBABILITY`, 판정 단계의 고정 점수로 계산했으면 `FIXED`다. 확률이 없는 항목만 고정 점수를 사용하며, 다른 항목의 점수와 계산 방식은 유지한다
  - `evaluation` 최상위에는 `scoreMethod`를 두지 않는다. 항목마다 계산 방식이 다를 수 있으므로 항목별 값만 기록한다
  - 판정이 없거나 3단계 밖이면 구조 깨짐으로 보고 재시도한다(5장)
  - `COVER_LETTER`는 여기서 임시 판정하고 EVALUATE에서 확정한다
  - `DELIVERY`는 화상이면 답변 글과 말하기 지표로, 채팅이면 답변 글로 판정한다. 비어 있는 지표는 빼고 판정하고, 지표가 모두 비어 있으면 답변 글로만 판정한다
- **결과** `answer.scored`에 `answerId`와 아래 `evaluation`을 담는다. BE는 `answers.evaluation`이 비어 있을 때만 저장한다

```json
{
  "criteria": {
    "JOB_FIT": { "level": 3, "score": 86, "scoreMethod": "PROBABILITY", "reason": "직무 요구 기술과 경험을 연결함" },
    "COVER_LETTER": { "level": 2, "score": 71, "scoreMethod": "PROBABILITY", "reason": "임시 판정" },
    "LOGIC": { "level": 3, "score": 88, "scoreMethod": "PROBABILITY", "reason": "원인 → 조치 → 결과 순서가 분명함" },
    "DELIVERY": { "level": 2, "score": 70, "scoreMethod": "FIXED", "reason": "핵심이 뒤에 나옴" }
  },
  "speech": { "fillerCount": 3, "speakingMs": 41000, "longPauseCount": 1, "syllablesPerMin": 310, "trailingOffRatio": 12.5, "pitchRangeSt": 6.2 },
  "promptVersion": "…",
  "modelVersion": "…"
}
```

## 4. EVALUATE: 결과 만들기

면접이 끝나면 남은 채점을 마치고 평가 STEP 02(자소서 대조)와 피드백을 만든다. 단계는 5.2의 `analysisStep`과 같다.

- **시작** 5.8(답변 ≥1)·5.9
- **입력(작업 메시지)** **[제안]** `mode`, `coverLetterItems`(2장과 같음), `claims`, 답한 질문마다 `answerId`·`seq`·`question`·`criteria`·`content`·`tokens`·`speech`(화상, `answers.speech`)·`evaluation`(SCORE_ANSWER가 이미 채점했으면 그 값, 아니면 null), `earlierSummaries`(같은 회원이 그날(한국 시간) 이 면접보다 먼저 시작해 결과가 나온 면접들의 `summary`, 시작 순. 없으면 빈 배열). 고도화에서는 회사 공시 요약을 더한다
- 답이 없는 질문(중간 종료)은 메시지에 넣지 않는다

| 단계 | 하는 일 |
|---|---|
| `ORGANIZING_ANSWERS` 답변 정리 | `evaluation`이 null인 답변을 3장과 같은 방식으로 채점한다(이미 있는 값은 유지). 화상이면 답변별 지표를 합쳐 `speech_metrics`를 만든다 |
| `SCORING` 기준별 분석 | STEP 02 자소서 대조: 자소서 원문(문항마다 질문 줄 다음 답변, 빈 줄로 이음)·`claims`와 답변을 대조해 근거가 맞는지 확인하고 `COVER_LETTER` 판정을 확정한다. 그다음 답변 점수 = 4항목 평균, 항목 점수 = 답한 질문들의 항목별 평균(정수) |
| `WRITING_FEEDBACK` 피드백 작성 | 답변마다 잘한 점·고칠 점, 항목마다 코멘트(255자 이하), 면접 총평(255자 이하). 고도화에서는 회사 공시 요약을 더한다 |

- `evaluation`을 새로 생성하거나 `COVER_LETTER` 판정을 확정할 때도 항목별 `scoreMethod`는 3장 규칙을 따른다. `COVER_LETTER` 점수를 다시 계산하면 해당 항목의 `scoreMethod`도 실제 계산 방식으로 갱신하고, 나머지 항목은 유지한다
- 단계가 바뀔 때마다 `evaluation.progress`를 보낸다
- **결과** `evaluation.completed`에 다음을 담는다 **[제안]**
  - `answers[]`: `answerId`, `score`, `goodPoint`, `improvePoint`, `evaluation`(`COVER_LETTER` 확정본)
  - `sessionScores[]`: `criterion`, `score`, `comment`
  - `speechMetrics`(화상만, 채팅은 null, 아래 집계)
  - `headline`: 결과 화면 맨 위의 한 줄 총평. 30자 이내. 넘으면 1회 다시 만들고, 그래도 넘으면 30자로 자른다(BE도 30자를 넘으면 자른다). BE가 `interview_sessions.headline`에 저장하고 6.3·5.13의 `summary`로 준다
  - `summary`: 성장 리뷰의 "다음에 해볼 것". 다음 면접에서 해 볼 것을 한두 문장으로 쓰고, `earlierSummaries`가 있으면 그 내용과 이번 면접을 모두 반영해 그날 전체에서 가장 중요한 것을 쓴다. BE는 그날 마지막 면접의 `summary`를 7.1에 보여 준다
- 답변끼리 어긋나는 내용(같은 경험의 수치·역할이 답변마다 다름)은 답변 전체를 함께 보고 해당 답변의 `improvePoint`에 기록한다
- 프롬프트 버전은 `evaluate-feedback-v2`(9장)
- BE는 한 트랜잭션에서 이 면접의 `session_scores`·`speech_metrics` 행과 `answers`의 점수·피드백을 지우고 다시 쓴 뒤 `COMPLETED`로 바꾼다(5.9로 다시 돌 때 유일성 제약 충돌 방지)
- `grade`는 보내지 않는다. BE가 점수로 계산한다(API 명세 6.3)

**`speech_metrics` 집계**

| 컬럼 | `speechMetrics` 키 | 계산 |
|---|---|---|
| `filler_per_min` | `fillerPerMin` | 전체 군말 수 ÷ 전체 말한 분(소수 둘째 자리) |
| `long_pause_count` | `longPauseCount` | 답변별 합계 |
| `speed_deviation_pct` | `speedDeviationPct` | (면접 말 속도 − 265) ÷ 265 × 100(%, 소수 둘째 자리). 면접 말 속도는 답변별 `syllablesPerMin`(3장)을 발화 시간(`speakingMs`)으로 가중한 평균이고, 265는 일반 성인의 대화 말 속도(음절/분)다 |
| `trailing_off_ratio` · `pitch_range_st` | `trailingOffRatio` · `pitchRangeSt` | 말한 시간으로 가중한 평균 |
| `gaze_ratio` | 키를 전송하지 않음 | 이 작업에서 사용하지 않음(API 명세 6.3) |

- 값이 있는 답변만으로 계산하고, 모든 답변에 값이 없으면 null이다
- 컬럼이 `NUMERIC(5, 2)`이므로 999.99를 넘는 값은 구하지 못한 것으로 간주해 null로 전송한다. 상한으로 잘라 전송하면 실제와 다른 지표가 되기 때문이다

## 5. 실패 처리

| 상황 | 처리 | `reason` |
|---|---|---|
| GMS 타임아웃·429·5xx | 3회 재시도. 다 실패하면 PLAN은 `plan.failed`, EVALUATE는 `evaluation.failed`. SCORE_ANSWER는 결과를 전송하지 않고 EVALUATE에 맡긴다 | `GMS_UNAVAILABLE` |
| 출력 구조 깨짐(JSON 아님, 개수·판정 값 틀림) | 1회 재시도 후 위와 같이 처리 | `INVALID_OUTPUT` |
| 확률만 없음 | 그 항목만 `FIXED`로 점수를 내고 로그를 남긴다 | — |
| BE 최대 대기 시간 초과 | PLAN 3분·EVALUATE 10분(BE 설계 5.1·5.4 `ai-job.plan-timeout`·`ai-job.analysis-timeout`)을 BE가 작업을 요청한 시각(`requestedAt`, 1.3)부터 계산한다. 큐에서 기다린 시간까지 포함해 BE와 같은 시각에 마감하기 위해서다. GMS를 호출하기 전마다 확인해 넘었으면 호출을 중단하고 실패 결과를 전송한다. 이미 BE가 `FAILED`로 처리한 작업에 GMS 비용과 처리 시간을 사용하지 않기 위해서다 | `TIMED_OUT` |
| 작업 메시지 형식 오류 | 1.3 | `INVALID_JOB` |
| 그 밖의 예상하지 못한 오류 | 실패 결과를 전송하고 작업을 마친다. 원인은 작업자 로그에 남긴다. 작업을 처리 중 리스트에 남기면 작업자를 다시 시작할 때마다 같은 오류가 반복되기 때문이다. SCORE_ANSWER는 결과를 전송하지 않는다 | `INTERNAL_ERROR` |
| 결과 큐에 넣기 실패 | 1·2·4초 간격으로 3회 재시도한다. 그래도 실패하면 작업을 처리 중 리스트에 남겨 작업자를 다시 시작할 때 다시 처리한다. 같은 결과가 두 번 전송돼도 BE가 제외한다(1.4) | — |
| 작업자 중단·메시지 유실 | 최대 대기 시간이 지나면 BE가 5.2 조회 때 `FAILED`로 변경한다(값은 API 명세 B-11) | — |

녹화 합치기의 실패 이유는 7장.

`FAILED`가 되면 화면은 5.3(플랜)·5.9(결과)로 다시 시도한다. 면접 에이전트의 실패 처리는 6.5.

## 6. 면접 에이전트

면접방(LiveKit)에 참가자로 들어가 면접을 진행한다. 질문을 말하고, 지원자 음성을 알아듣고, 리액션을 정하고, 답변이 끝났는지 판단해 BE에 넘긴다. LiveKit Agents(Python)로 만들고 STT는 원본 토큰별 시각을 보존하도록 Soniox WebSocket에 직접 연결한다. TTS는 ElevenLabs REST `POST /v1/text-to-speech/{voice_id}/with-timestamps`로 질문 글 하나를 통째로 합성해 음성(PCM 24kHz)과 원문 글자별 발음 시각을 함께 받는다 **[결정]**. `question`(`started`)에 질문 전체의 글자별 시각을 담아야 하는데, LiveKit ElevenLabs 플러그인은 시각을 단어 단위로 묶고 스트리밍 중 조각마다 늦게 주기 때문이다. 질문 5개는 배정 때 알고 있으므로 미리 합성해 지연을 줄인다. 면접관별 음성 id는 DEVIL `FXxhHa2cRkhRQpD1I1Ut`, COFFEE_CHAT `kv35JHV8eknIPqadZFol`, 모델은 `eleven_multilingual_v2`다. 화면 동작은 [API 명세 면접방 메시지](API-명세.md#면접방-메시지-livekit)를 따른다.

### 6.1 배정

BE가 5.4에서 LiveKit `AgentDispatchService.CreateDispatch`로 에이전트를 면접방에 배정한다. 에이전트는 이름을 지정한 배정만 받는다.

| 항목 | 값 |
|---|---|
| 에이전트 이름 | `a301-interviewer` **[제안]** |
| 방 이름 | `interview-{sessionId}` **[결정]**(API 명세 5.14). 지원자 참가자 이름은 `candidate` |
| 에이전트 참가자 이름 | `interviewer` **[결정]**. 화상 녹화 파일 이름이 참가자 이름으로 시작하므로(7장) 이 이름으로 들어와야 한다 |
| 배정 정보(metadata, JSON, 512KiB 이하) | 아래 **[제안]** |

```json
{ "sessionId": 55, "mode": "VIDEO", "persona": "DEVIL", "currentSeq": 1,
  "questions": [
    { "seq": 1, "content": "응답 시간을 40% 줄인 과정은?", "criteria": "원인 분석 · 수치 근거" }
  ] }
```

- `questions`는 5개 전부. 에이전트는 DB를 읽지 않으므로 질문 글과 채점 기준을 여기서 받는다
- 형식이 틀리면(질문 5개가 아님, 질문 글·채점 기준이 비어 있음, 512KiB 초과 등) 에이전트는 배정을 거절한다(6.5)
- `currentSeq`: 몇 번 질문부터 할지. 처음엔 1이고, 에이전트가 중간에 끊겨 다시 배정할 때 이어 갈 번호다
- 면접이 끝나면 BE가 방을 삭제(`RoomService.DeleteRoom`)하고 에이전트는 그 면접을 정리한다. 끝나지 않은 답변은 보내지 않는다

### 6.2 진행 흐름

질문마다 다음을 반복한다(1~5번).

1. **질문** `question.started` 결과 메시지(`seq`, `startedAt`)를 보내고, 면접방 메시지 `question`(`started`)을 보낸 뒤 질문 글을 TTS로 말한다. 다 말하면 `question`(`ended`), 합성에 실패하면 `failed`
2. **듣기(화상)** 지원자 음성을 STT로 수신해 확정 토큰과 시각을 수집한다. 에이전트는 `interview.stt` 텍스트 스트림으로 확정 글·미확정 글의 전체 스냅샷을 지원자 화면에 전달한다. 미확정 글은 교체하며 토큰별 시각은 에이전트에 보존한다. 같은 음성으로 말끝 흐림·억양 폭(3장)을 계산한다
3. **리액션** 화상은 문장이 끝날 때마다(문장 끝 기준은 API 명세 면접방 메시지), 채팅은 `chat.input`을 받을 때마다 입력 글의 마지막 문장을 Jev로 판단해 `reaction`을 보낸다(6.4)
4. **답변 끝(화상)** 마지막 말소리 뒤 7초 침묵(임시 값) 또는 `answer.submit`이면 답변을 끝낸다. 말 끊기 안내 음성(6.3)을 재생하는 동안에는 7초 계산을 멈추고, 재생이 끝난 시점부터 7초를 다시 계산한다. 안내 음성의 합성을 기다리는 동안에는 계산을 멈추지 않는다. 한마디도 안 했으면 끝내지 않고, 60초(임시 값) 동안 말을 시작하지 않으면 `answer.state`(`timedOut`)를 보낸다. 전송한 뒤에도 같은 질문에서 계속 듣고, 말을 시작하면 7초 규칙으로 끝낸다. 다음 질문으로 진행하지 않으며, 면접을 중단하려면 면접 끝내기(API 명세 5.8)를 사용한다. STT 오류 뒤에도 같다(6.5)
5. **답변 전달(화상)** `answer.completed` 결과 메시지를 보내고 `answer.state`(`submitted`)를 보낸다

```json
{ "type": "answer.completed", "sessionId": 55, "seq": 3,
  "answerStartedAt": "2026-10-22T14:02:18.250+09:00",
  "content": "조회 쿼리 실행 계획을 보고…",
  "tokens": [ { "text": "조회", "startMs": 0, "endMs": 280 } ],
  "speech": { "trailingOffRatio": 12.5, "pitchRangeSt": 6.2 },
  "endReason": "AUTO_SUBMIT", "occurredAt": "2026-10-22T14:03:12+09:00" }
```

- `answerStartedAt`: 에이전트가 그 답변을 듣기 시작한 시각(밀리초까지). `tokens` 시각의 0ms이고, 다시보기에서 녹화 시작 시각과의 차이로 답변 위치를 구한다
- `content`: 답변 글. 1~10,000자(BE와 같은 UTF-16 단위). 넘는 답변은 잘라 전송하지 않는다. 채점 대상 글이 변경되기 때문이다
- `tokens`: STT가 확정한 토큰을 그대로(단어 일부·공백 포함, 단어로 합치지 않음). 끝 표시 토큰(`<end>`·`<fin>`)은 제외한다. 10,000개 이하, `0 ≤ startMs ≤ endMs`. STT가 재연결돼도 시각은 `answerStartedAt` 기준으로 이어서 계산한다. 토큰이 없으면 null
- `speech`: 말끝 흐림 비율 `trailingOffRatio`·억양 폭 `pitchRangeSt`(계산은 3장 표). 구하지 못한 값은 null
- `question.started`의 `startedAt`도 밀리초까지 기록한다(다시보기 마커 기준)
- `endReason`: `AUTO_SUBMIT`(침묵 7초) · `MANUAL_SUBMIT`([답변 완료])
- **채팅** 답변은 화면이 5.7로 BE에 낸다. 화면은 5.7 응답이 202이거나 409 `ANSWER_ALREADY_SUBMITTED`이면 `answer.submit`(`seq`)을 전송한다. 409를 포함하는 것은 새로고침 뒤 다시 제출해 이미 저장된 답변도 다음 질문으로 진행하게 하기 위함이다. 에이전트는 `seq`가 지금 질문일 때만 다음 질문으로 진행하고, 이미 진행한 질문의 `answer.submit`은 무시하고 `false`로 응답한다
- 5번 질문의 답변이 끝나면 더 말하지 않는다. 면접 끝내기는 화면이 답변 저장을 확인한 뒤 호출한다(API 명세 5.8)

### 6.3 면접방 메시지 형식 **[제안]**

STT 표시는 LiveKit 텍스트 스트림 `interview.stt`로 선택된 지원자에게만 전달한다. 본문은 아래 JSON 전체 스냅샷이다.

```json
{ "streamId": "캡처마다 생성한 UUID", "revision": 3,
  "confirmedText": "안녕하세요.", "interimText": " 저는",
  "state": "listening" }
```

- `streamId`는 마이크 캡처를 다시 시작하면 바뀌고, `revision`은 같은 캡처에서 증가한다. 화면은 같은 캡처의 오래된 갱신을 버리고 글 전체를 교체한다.
- `confirmedText`는 누적 확정 글, `interimText`는 최신 미확정 글이다. `state`는 `listening`·`failed`다. 토큰별 시각은 이 메시지에 포함하지 않는다.
- 브라우저는 현재 면접의 5.14 입장 정보로 연결하고 기존 마이크 트랙을 송출한다. 장치 권한과 입장 토큰은 별개다.
- 새로고침 후에는 새 캡처를 시작하며 이전 자막은 복원하지 않는다. 이 메시지는 DB에 저장하지 않는다.

이하 RPC의 본문은 JSON 문자열(15KiB 이하)이다. 질문은 `seq`(질문 순서 1~5)로 가리키고, 리액션·채팅 입력은 `seq`를 메시지 순번으로 사용하므로 질문을 `questionSeq`로 가리킨다. 메시지 종류와 화면 동작은 API 명세 면접방 메시지를 따른다.

RPC 메시지에 공통 필드 `type`(메시지 종류, API 명세 면접방 메시지 표의 메시지 이름)과 `sessionId`(면접 id)를 담는다. 아래 표의 필드는 공통 필드를 제외한 것이다. `interview.stt` 스냅샷에는 이 공통 필드를 사용하지 않는다.

| RPC 메서드 | 방향 | 필드 |
|---|---|---|
| `interview.question` | 에이전트 → 화면 | `seq`, `content`, `speech`(`started`·`ended`·`failed`), `alignment`(`started`에만 `{ chars[] }`, `chars[]` = `{ char, startMs, endMs }`, 질문 음성 맨 앞이 0. 그 밖에는 null. 키는 항상 담는다) |
| `interview.reaction` | 에이전트 → 화면 | `questionSeq`(질문 순서), `seq`(그 답변 안에서 1부터 증가, 화면은 가장 큰 값만 씀), `reaction`(`type`·`expression`·`gesture`·`intensity`·`durationMs`, 판단하지 못했거나 반응할 내용이 없으면 null), `attitude`(`interest`·`trust`, 0~1, 첫 판단 전에는 0.5), `interrupt`(`reason`: `OFF_TOPIC`·`TOO_LONG`, `text`, 채팅은 항상 null) |
| `interview.answerState` | 에이전트 → 화면 | `seq`(질문 순서), `state`: `autoSubmitted` · `timedOut` · `sttReconnecting` · `sttFailed` · `submitted` · `submitFailed` |
| `interview.answerSubmit` | 화면 → 에이전트 | `seq`(질문 순서). 응답 `{ "accepted": true }`, 이미 제출 중이면 `false`. `submitFailed` 뒤에 수신하면 보관한 답변을 다시 전송하고 `true`로 응답한다(6.5) |
| `interview.chatInput` | 화면 → 에이전트 | `questionSeq`(질문 순서), `seq`(그 답변 안에서 1부터 증가), `text`(입력 칸 전체, 1,000자 이하), `pauseMs`. 응답 `{ "accepted": true }`. 현재 진행 중인 질문이 아니거나 그 질문에서 이미 수신한 `seq` 이하면 판단하지 않고 `false`로 응답한다. `true`는 판단 대상으로 수신했다는 뜻이며 리액션 판단의 성공을 뜻하지 않는다 |

- RPC 오류: `2001 EMPTY_ANSWER`(한마디도 안 함), `2002 NOT_ANSWERING`(질문 음성 재생 중 등). 1001~1999는 LiveKit 예약
- 발음 시각이 15KiB를 넘으면 나눠 보낼지 텍스트 스트림을 쓸지 **[미정]**. 지금은 `alignment`를 null로 보내고 질문 음성은 그대로 낸다(한글 질문 약 330자 이상에서 발생)
- 화면이 RPC를 받지 못해도(처리 함수 없음·3초 안에 응답 없음) 질문 음성은 계속 낸다
- 말 끊기(`interrupt`)의 `text`는 에이전트가 음성으로도 말한다. 말 끊기는 답변을 제출하지 않으며, 지원자는 같은 질문의 답변을 이어서 말한다. 말 끊기 전후의 발화는 하나의 답변으로 제출된다. 안내 음성을 재생하는 중에 `answer.submit`을 수신하면 `2002`로 거절하지 않고, 안내 음성을 멈춘 뒤 답변을 제출한다
- `reaction.durationMs`는 2,400ms다. 리액션이 없을 때와 `durationMs`가 지난 뒤 면접관은 기본 상태(듣는 중 `listening`, 무표정)다
- `reaction` 객체는 키를 항상 모두 담고, 해당하지 않는 값은 null이다. 표정이면 `gesture`가, 동작이면 `expression`·`intensity`가 null이다. 화면이 키가 있는지 분기하지 않고 같은 형식으로 읽게 하기 위해서다

### 6.4 리액션 판단 (Jev)

- 입력: 질문·채점 기준(배정 정보), 전송된 글(화상은 끝난 문장, 채팅은 입력 글의 마지막 문장)과 쉰 시간, 지금까지의 답변 글, 직전 태도(`attitude`). 면접 방식은 발화 중단을 판단할지 정하는 데만 쓴다. 최근 글·태도는 에이전트가 면접 동안 메모리에 둔다
- 채팅은 반응 여부·종류를 입력 글의 마지막 문장으로 판단하고, 관심·신뢰는 입력 글 전체로 판단한다. 마지막 문장은 3장 말하기 지표와 같은 문장 경계로 나누며, 종결어미 없이 끝난 작성 중인 글도 한 문장으로 본다. 반응 여부를 입력 글 전체로 판단하면 입력이 멈출 때마다 판단 결과가 거의 같아, 화상보다 리액션이 드물게 전송되기 때문이다
- 면접관 종류(`persona`)는 넣지 않는다. 리액션 값은 면접관과 관계없고 화면이 면접관별로 표현을 달리하므로(API 명세 B-8) 판단에 필요하지 않다
- Jev(`POST /v1/systemone`, 질문 유형 `choice`·`score`·`noul`)로 `reaction`·`attitude`를 판단한다. 모델은 버전 ID `jev-1.14.0`으로 고정한다. 별칭(`jev-latest`)은 새 버전이 나오면 코드 변경 없이 호출 모델이 변경돼 리액션·발화 중단 기준값이 맞지 않게 되기 때문이다
- 발화 중단(`interrupt`) 중 질문 이탈(`OFF_TOPIC`)은 Jev로 판단하고, 지나치게 긴 답변(`TOO_LONG`)은 발화 시간(3장 `speakingMs`)으로 코드에서 판단한다. 수치 비교는 Jev가 아니라 코드에서 처리한다. Jev는 글을 생성하지 않으므로 `interrupt.text`는 이유(`reason`)·면접관별로 설정에 둔 문구를 사용한다. 채팅이면 발화 중단은 판단하지 않는다
- 기준값: 반응할 내용이 있다고 판단한 확률이 0.5 이상이면 `reaction`을 전송하고, 미만이면 null로 전송한다. 표정 세기(`intensity`)는 0.4로 고정한다. 판단 확률은 확신의 정도이고 표정의 세기가 아니기 때문이다. 질문 이탈 확률이 0.7 이상이면 `OFF_TOPIC`, 발화 시간이 120초 이상이면 `TOO_LONG`이다. 네 값 모두 임시 값이며, 실제 Jev 판단과 답변 길이를 확인한 뒤 조정한다
- 두 이유에 함께 해당하면 질문 이탈(`OFF_TOPIC`)을 전송한다. 긴 답변(`TOO_LONG`)은 Jev 응답을 기다리지 않고 판단하며, 질문 이탈 판단이 아직 없으면 긴 답변을 바로 전송한다
- 발화 중단은 같은 답변에서 이유마다 한 번만 전송한다. 한 답변에서 최대 두 번이며, 다음 질문의 답변에서는 다시 판단한다
- 0.8초(임시 값) 안에 답을 받지 못하거나 호출이 실패하면 `reaction: null`, `attitude`는 직전 값으로 보낸다
- 채팅은 가장 최근에 수신한 입력의 판단 결과만 적용한다. 판단이 끝나기 전에 같은 질문의 새 입력을 수신하면, 이전 입력의 판단 결과는 전송하지 않고 태도에도 반영하지 않는다. 지원자가 이미 삭제하거나 수정한 글에 면접관이 반응하지 않게 하기 위함이다

### 6.5 실패 처리

| 상황 | 처리 |
|---|---|
| Jev 늦음·실패 | 그 문장은 리액션 없이 넘어감(6.4) |
| LiveKit 일시 끊김 | 브라우저 SDK가 재접속하며 화면에 연결 중 상태를 표시한다. 완전히 끊기면 [다시 연결]로 5.14 입장 정보를 새로 받는다 |
| 지원자 퇴장·새로고침 | 현재 STT 캡처를 정리하고 에이전트는 방에서 재입장을 기다린다. 재입장하면 새 캡처를 시작한다. 답변 중이었으면 그때까지 인식한 글을 폐기하고 답변 끝 판단의 7초·60초 계산을 멈추며, 재입장하면 같은 질문의 답변을 처음부터 다시 듣는다. 질문 음성 재생 중에 퇴장했으면 재입장 뒤 면접방 메시지 `question`(`started`)부터 질문을 다시 말하고, 결과 메시지 `question.started`는 다시 전송하지 않는다. 리액션의 태도(`attitude`)는 면접 전체에 대한 값이므로 유지하고, 폐기한 답변으로 판단 중이던 리액션은 전송하지 않는다. 같은 질문의 리액션 `seq`는 1로 되돌리지 않고 이어서 증가시킨다. 새로 연결한 화면은 이전 채팅 입력 `seq`를 알 수 없으므로, 재입장하면 수신한 채팅 입력 `seq` 기록을 초기화한다 |
| Soniox STT 오류 | `interview.stt`의 `state: failed`와 `answer.state`(`sttFailed`)를 전송한다. 화면은 마지막 텍스트와 실패 안내를 유지한다. 그 답변에서 발화가 있었으면, [답변 완료](`answer.submit`)를 수신할 때 그때까지 인식된 글을 제출한다. STT 오류는 지원자가 일으킨 것이 아니므로 인식된 글을 폐기하지 않는다. 발화가 없었으면 [답변 완료]는 `2001 EMPTY_ANSWER`로 거절되므로, 오류 상태에서도 60초를 계속 계산해 답변 시작 60초 뒤 `answer.state`(`timedOut`)를 전송한다 |
| TTS 실패 | `question`에 `failed`. 화면은 질문 글로 진행 |
| 결과 큐에 넣기 실패 | 1·2·4초 간격으로 3회 재시도(5장). 답변 완료(`answer.completed`)가 재시도 후에도 실패하면 `answer.state`로 `submitFailed`를 전송한다. 에이전트는 그 답변을 메모리에 보관하고 다음 질문으로 진행하지 않는다. 화면은 실패를 안내하고 [다시 시도]를 표시하며, 에이전트는 `submitFailed` 상태에서 `answer.submit`을 수신하면 보관한 같은 답변을 같은 재시도 규칙으로 다시 전송한다. 성공하면 `answer.state`(`submitted`)를 전송하고 다음 질문으로 진행한다. 면접을 중단하려면 면접 끝내기(API 명세 5.8)를 사용하며, 이때 보관한 답변은 저장되지 않는다. `submitFailed` 상태에서 지원자가 재입장하면 `submitFailed`를 다시 전송한다. 새로 연결한 화면은 실패 상태를 알 수 없기 때문이다. 같은 결과가 두 번 전송돼도 BE가 제외한다 |
| 저장할 수 없는 답변 | 답변 글·토큰이 `answer.completed`의 범위(6.2)를 벗어나면 다시 전송해도 BE가 저장하지 못하므로, `answer.completed`를 전송하지 않고 다음 질문으로 진행한다. `answer.state`(`submitted`·`submitFailed`)는 전송하지 않으며, 그 답변은 저장되지 않는다 |
| 에이전트가 면접 도중 끊김 | BE가 `currentSeq`를 넣어 다시 배정한다. 누가 끊김을 알아채고 언제 다시 배정할지 **[미정]** |
| 동시 면접 상한 초과 | 배정을 거절하고 결과 메시지 `assignment.rejected`(`CAPACITY_EXCEEDED`)를 전송한다. BE는 면접방을 닫고 면접을 `START_FAILED`로 변경하며, 화면은 다시 시작(API 명세 5.4)을 안내한다(1.4) |
| 배정 정보 형식 오류 | LiveKit이 배정을 에이전트에 전달할 때 방에 들어가지 않고 거절한다. 틀린 배정 정보로는 질문을 진행할 수 없고, 같은 배정 정보로는 어느 에이전트 서버도 진행할 수 없으므로 다른 에이전트 서버에 다시 넘기지 않는다. 결과 메시지 `assignment.rejected`(`INVALID_ASSIGNMENT`)를 전송하고, BE·화면 처리는 동시 면접 상한 초과와 같다 |

## 7. MERGE_RECORDING: 녹화 합치기

화상 면접이 끝나면 Egress가 저장한 트랙(지원자 영상·음성, 면접관 음성)을 mp4 하나로 합친다(운영 배포 계획 4.3).

- **시작** 5.8(화상). 면접 중이 아니라 끝난 뒤 큐 작업으로 하므로 면접 중 CPU를 쓰지 않는다
- **입력(작업 메시지)**
  - `rawPrefix`: 원본 트랙 위치. S3 `recordings/raw/{sessionId}/`로 시작하고, BE가 녹화를 시작할 때 정한다
  - `objectKey`: 결과 위치 `recordings/{sessionId}.mp4`
  - 다른 면접의 녹화를 읽거나 덮어쓰지 않도록, 두 값이 그 작업 `sessionId`의 위치가 아니면 형식 오류(1.3)로 처리한다
- **원본 트랙 파일** **[결정]** BE가 방을 만들 때 켠 트랙 자동 녹화가 `rawPrefix` 아래 `{참가자 이름}-{트랙 종류}-{트랙 id}.{확장자}`로 저장한다. 트랙 id(`TR_…`)는 LiveKit 서버가 붙이므로 미리 알 수 없다
  - 이름 앞부분으로 찾는다: `candidate-video-`(지원자 영상, H.264 → `.mp4`), `candidate-audio-`(지원자 음성, `.ogg`), `interviewer-audio-`(면접관 음성, `.ogg`)
  - 재접속으로 트랙을 다시 올리면 같은 종류 파일이 하나 더 생긴다(덮어쓰지 않음). 여러 개면 녹화 시작 시각 순서로 이어 붙인다
- **처리** 영상은 다시 인코딩하지 않고 그대로 복사하고, 두 음성은 한 트랙으로 혼합해 AAC로 인코딩한 mp4를 `objectKey`에 업로드한다
  - 화상 면접 화면은 카메라 영상을 H.264로 송출한다. Egress 트랙 녹화는 영상을 다시 인코딩하지 않고 코덱에 맞는 형식으로 저장하므로(H.264는 MP4, Opus는 OGG) 합친 mp4도 브라우저에서 그대로 재생된다
  - 영상을 다시 인코딩하면 합치기가 면접 길이에 비례해 오래 걸려, 작업을 하나씩 처리하는 작업자에서 뒤에 대기한 작업이 BE 최대 대기 시간을 넘을 수 있다
- **결과** `recording.merged`(`objectKey`). 실패하면 `recording.mergeFailed`(`TRACK_NOT_FOUND`·`STORAGE_ERROR`·`MERGE_ERROR`·`INVALID_JOB`·`INTERNAL_ERROR`, 1.4). 같은 작업을 다시 처리해도 결과가 같을 가능성이 높으므로 재시도하지 않는다. BE는 다시보기에서 `videoStatus: FAILED`로 응답한다(API 명세 6.4)

## 8. 회사 공시 요약 (고도화)

DART 공시를 수집·정제(중복 제거·기업명 매칭)하고 LLM으로 출처가 붙은 요약을 만든다. MVP 범위 밖이다.

```json
{ "companyName": "○○전자", "summary": "…",
  "sources": [ { "title": "사업보고서 (2026.03)", "url": "https://dart.fss.or.kr/…", "publishedAt": "2026-03-14" } ] }
```

- 메인 DB 회사 요약 Table에 넣는 경로는 「DB는 BE만」 원칙에 맞춰 고도화 때 정한다 **[미정]**. 테이블 초안은 [회사 카드 ERD](ERD-회사카드.md)
- 지원서와는 `applications.company_name`의 기업명 매칭 결과로 잇는다
- BE가 PLAN·SCORE_ANSWER·EVALUATE 작업 메시지에 요약을 담아 보낸다. 요약이 없으면 빼고 그대로 진행한다

## 9. 버전

등록된 Prompt·Model·Rubric 버전만 사용한다(CONTRIBUTING 7장). Model은 요청하는 모델 ID(예: `gpt-4.1-mini`)를 등록해 검사하고, 결과에는 GMS 응답에 실린 스냅샷 이름(날짜 포함, 예: `gpt-4.1-mini-2025-04-14`)을 기록한다. GMS는 스냅샷 이름으로 요청을 받지 않으므로 요청은 모델 ID로 하고, 처리한 스냅샷은 응답 이름으로 남긴다. PLAN은 `plan.completed`에 담아 `interview_plans`에, SCORE_ANSWER는 `evaluation` 안에 담아 `answers.evaluation`에 남긴다. EVALUATE는 로그에만 남긴다(DB 저장은 범위 제외).

## 10. 확인 필요

| 내용 | 영향 |
|---|---|
| 실제 Jev 호출로 본 한국어 답변 판단 정확도, 서울에서의 응답 시간, 선택지 순서를 변경해도 판단이 같은지(모델 `jev-1.14.0`) | 6.4 |
| LiveKit Egress 트랙 녹화 파일이 저장소에 완성되는 시점(파일 형식은 LiveKit 문서로 확인: H.264는 MP4, Opus는 OGG), 화면이 H.264가 아닌 코덱(VP8 등)으로 송출했을 때 Egress의 저장 결과 | 7장 원본 트랙 파일 |
| Soniox WebSocket 직접 연결로 실제 한국어 음성의 확정 토큰·시각·끝 표시(`<end>`) 수신, 시각 누락·연결 끊김 처리 검증 | 6.2 `tokens`, 문장 끝 판단, 3장 말하기 분석 |
