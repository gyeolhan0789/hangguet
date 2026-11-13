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
8. [회사 카드](#8-회사-카드)
9. [버전](#9-버전)
10. [확인 필요](#10-확인-필요)

## 1. 구성

```
브라우저 ─ BE(Spring)                     모든 API (API 명세)
브라우저 ⇄ LiveKit 면접방 ⇄ AI 면접 에이전트  음성 · 면접방 메시지 (6장)
                              └─▶ Soniox(STT) · ElevenLabs(TTS) · Jev · GMS(꼬리질문)

BE ─ Redis 작업 큐 3개(1.3) ─▶ AI 분석 작업자 ─▶ GMS · ffmpeg   PLAN · EXTRACT_CLAIMS · SCORE_ANSWER · EVALUATE · MERGE_RECORDING
BE ◀─ Redis 결과 큐 ai:results ─ AI 분석 작업자 · AI 면접 에이전트
BE ─ LiveKit 서버 API ─▶ 에이전트 배정(질문 5개 · 채점 기준 · 연결 회사 항목) · 방 삭제 · Egress 녹화
```

- **AI는 DB에 접속하지 않는다** **[결정]**(읽기 · 쓰기 모두). 입력은 BE가 작업 메시지(1.3)와 에이전트 배정 정보(6.1)에 담아 보내고, 출력은 결과 메시지(1.4)로 돌려준다. BE가 받아 검증한 뒤 DB와 Redis 진행 상태에 쓴다
  - 왜: 스키마는 BE의 Flyway가 관리한다. AI가 같은 테이블을 직접 다루면 마이그레이션 때마다 두 파트가 함께 고쳐야 하고, 면접 상태 규칙이 두 곳에 생긴다. AI와 BE 사이 계약을 메시지 형식 하나로 둔다
- BE와 AI는 서로 HTTP로 부르지 않는다. Redis 큐와 LiveKit만 거친다. BE는 DB 커밋과 함께 Outbox로 작업을 큐에 넣는다(CONTRIBUTING 6.2)
- 외부 서비스: GMS(LLM, 분석 작업자·면접 에이전트), Jev(면접관 반응), Soniox(STT), ElevenLabs(TTS). 모두 AI 서버에서만 부르고 키도 AI 서버에만 있다. 면접 중에는 꼬리질문 생성(2.2)에만 GMS를 호출한다
- 평가 항목은 `JOB_FIT`(직무 적합성)·`COVER_LETTER`(자소서 검증)·`LOGIC`(논리성)·`DELIVERY`(전달력) 4개이고, 판정은 3단계(좋아요·보통·아쉬워요)다

### 1.1 주체별 입력과 출력

| 주체 | 시작 | 입력 | 출력(결과 메시지) | BE가 저장하는 곳 |
|---|---|---|---|---|
| 자기소개서 검증 | 4.1(API 명세) | 검증 큐 `ai:checks` | 작업별 결과 키(2.1) | 없음(BE가 저장 요청 안에서 받음) |
| EXTRACT_CLAIMS | 4.1 저장 뒤, 지원서 주장이 없을 때의 5.1·5.3 | 작업 메시지 | `claims.extracted` · `claims.extractFailed` | `application_claims`(지원서 주장, 2장) |
| PLAN | 5.1·5.3 | 작업 메시지 | `plan.progress` · `plan.completed` · `plan.failed` | `interview_plans`, 질문 보관함(2장), Redis `planStatus`·`planProgress` |
| SCORE_ANSWER | 답변 저장 직후 | 작업 메시지 | `answer.scored` | `answers.evaluation` |
| EVALUATE | 5.8(답변 ≥1)·5.9 | 작업 메시지 | `evaluation.progress` · `evaluation.completed` · `evaluation.failed` | `answers`의 `score`·`good_point`·`improve_point`·`evaluation`, `session_scores`, `speech_metrics`, `interview_sessions`의 `status`·`summary`, Redis `analysisStep` |
| MERGE_RECORDING | 5.8(화상) | 작업 메시지 | `recording.merged` · `recording.mergeFailed` | `recordings` |
| 면접 에이전트 | 5.4 배정 | 배정 정보, 면접방 음성 · 메시지 | `question.started` · `answer.completed` · `assignment.rejected` · `room.closed` | `interview_questions`, `answers`(화상, `speech` 포함), `interview_sessions`의 `status` |

`interview_plans`(`claims`·`questions`), `answers.tokens`, `answers.evaluation`은 DB 스키마(BE 마이그레이션 V2)에 JSONB로 있다. 형식은 이 문서 2·3장을 따른다. 에이전트가 계산한 음성 지표(`answer.completed`의 `speech`, 6.2)를 저장할 `answers.speech`(JSONB)와 `answerStartedAt`을 저장할 `answers.started_at`은 BE 마이그레이션 V4로 추가했다. 이 값은 실시간 음성으로만 계산하므로 채점이 실패해도 결과 생성(4장)에서 사용할 수 있도록 답변과 함께 저장한다. 같은 `speech`에 다시보기 타임라인용 값 `trailingOffAtMs`(말끝 흐린 문장의 끝 시각, 3장)와 `impressions`(답변 중 인상 판단, 6.6)도 담는다 **[제안]**. 둘 다 실시간 음성·사진으로만 구할 수 있고 답변 시각 기준이라 답변과 함께 둔다. 지금은 저장만 하고 채점·결과에는 쓰지 않는다.

### 1.2 Redis 진행 상태

- 키는 Redis Hash `session:{sessionId}:runtime`이고 **BE만 쓴다** **[결정]**. AI는 진행 상태를 결과 메시지(`plan.progress`·`evaluation.progress`)로 보내고, BE가 `planStatus`·`planProgress`·`analysisStep`에 쓴다
- Redis 값이 없으면 `interview_plans` 행이 있을 때 `planStatus`를 `READY`로 본다(BE)

### 1.3 작업 메시지 (BE → AI)

- 큐는 작업 종류별 Redis List 3개다. BE가 `jobType`에 맞는 큐에 `LPUSH`하고, 작업자는 `BLMOVE {큐} {처리 중 리스트} RIGHT LEFT`로 꺼내 처리한 뒤 처리 중 리스트에서 지운다(작업자가 멈춰도 메시지가 남음)

  | 큐 | 처리 중 리스트 | 작업 | 작업자(`AI_WORKER_QUEUE`) |
  |---|---|---|---|
  | `ai:jobs:plan` | `ai:jobs:plan:processing` | PLAN · EXTRACT_CLAIMS | `plan` |
  | `ai:jobs:recording` | `ai:jobs:recording:processing` | MERGE_RECORDING | `recording` |
  | `ai:jobs` | `ai:jobs:processing` | SCORE_ANSWER · EVALUATE | `default`(기본값) |

- 작업자는 작업을 하나씩 처리하므로, 큐가 하나이면 녹화 합치기·결과 생성이 몰릴 때 사용자가 기다리는 PLAN이 최대 대기 시간(5장)을 넘긴다. 그래서 PLAN과 MERGE_RECORDING을 별도 큐로 나눈다
- 큐마다 작업자를 1대 둔다. 작업자는 시작할 때 자기 처리 중 리스트에 남은 작업만 자기 큐로 되돌리므로, 큐마다 처리 중 리스트가 달라야 다른 작업자가 처리 중인 작업을 되돌리지 않는다
- `default` 작업자는 모든 작업의 처리 함수를 등록한다. 자기소개서 검증 전용 큐(`ai:checks`, 2.1)도 `default` 작업자가 받는다. 큐를 나누기 전에 `ai:jobs`에 들어간 PLAN·MERGE_RECORDING도 처리하기 위함이다
- 공통 필드: `jobType`(`PLAN` · `EXTRACT_CLAIMS` · `SCORE_ANSWER` · `EVALUATE` · `MERGE_RECORDING`), `jobId`(UUID 문자열), `sessionId`, `requestedAt`(BE가 작업을 요청한 시각, ISO 8601). BE와 AI는 PLAN·EXTRACT_CLAIMS·EVALUATE의 최대 대기 시간(5장)을 모두 이 값부터 계산한다
  - EXTRACT_CLAIMS는 면접이 아니라 지원서 단위 작업이므로 `sessionId` 대신 `applicationId`를 담는다. 결과 메시지(`claims.extracted`·`claims.extractFailed`)도 같다
- 그룹 면접(API 명세 10장)의 면접도 같은 큐 · 같은 작업 종류를 쓴다. 달라지는 필드는 PLAN `questionCount`(2장)와 MERGE_RECORDING의 그룹 필드(7장)뿐이다 **[결정]**. SCORE_ANSWER · EVALUATE는 필드가 같고, 한 면접의 질문이 4~6개일 수 있다. 질문 수 5개를 가정하는 곳이 없는지 확인한다 **[미정]**
- AI가 DB를 읽지 않으므로 **작업에 필요한 내용을 모두 메시지에 담는다** **[제안]**. 작업별 필드는 2·3·4·7장
- PLAN·SCORE_ANSWER·EVALUATE는 면접관 `persona`(`DEVIL` 악마 면접관 · `COFFEE_CHAT` 개발자 면접관 · `DUCK` 오리 면접관)를 담는다. 질문 수준(2장)과 피드백 관점(4장)을 면접관에 따라 다르게 만들기 위함이다. SCORE_ANSWER의 `persona`는 판정에 사용하지 않는다(3장)
  - `persona`가 없으면 `COFFEE_CHAT`으로 처리한다. 필드를 추가하기 전에 BE가 보낸 작업과 배포 순서 차이를 처리하기 위함이다
  - 위 `persona` 값이 아니면 형식이 틀린 작업이다
  - `DUCK`은 AI가 수신을 구현한 뒤 BE가 전송한다. AI 구현 전에 전송하면 형식이 틀린 작업으로 실패하기 때문이다
- PLAN·EVALUATE는 면접을 만들 때 정한 회사 카드 `companyCard`(8장)를 담는다. 회사를 찾지 못했거나 카드가 없으면 필드를 담지 않는다
- BE는 Outbox로 보내므로 같은 메시지가 두 번 올 수 있다. AI는 같은 작업을 두 번 처리해도 되고, 중복 결과는 BE가 거른다(1.4)
- 형식이 틀린 작업(필수 필드 누락, 형식·범위 불일치)은 다시 처리해도 결과가 같으므로 재시도하지 않는다
  - `jobType`·`jobId`·`sessionId`(EXTRACT_CLAIMS는 `applicationId`)를 해석할 수 있으면 그 작업의 실패 결과(`plan.failed`·`claims.extractFailed`·`evaluation.failed`·`recording.mergeFailed`)를 `reason: INVALID_JOB`으로 즉시 전송한다. 화면이 BE 최대 대기 시간까지 기다리지 않고 다시 시도로 넘어가게 하기 위함이다
  - SCORE_ANSWER는 실패 결과 종류가 없으므로 결과를 전송하지 않는다(EVALUATE가 마저 채점)
  - 세 필드 중 하나라도 해석할 수 없으면 결과 없이 폐기하고 로그를 남긴다
- 명세에 없는 필드는 무시한다. 고도화에서 필드가 추가돼도 배포 순서와 관계없이 처리하기 위해서다
- PLAN·EVALUATE 작업과 자기소개서 검증(2.1) 메시지에 `coverLetterItems`가 없고 이전 BE의 `coverLetter`(글 하나)가 있으면 질문 '자기소개서'인 1번 문항으로 읽는다. 배포 중 큐에 남은 이전 메시지를 처리하기 위한 것으로, 다음 배포에서 지운다

```json
{ "jobType": "SCORE_ANSWER", "jobId": "8f0c…", "sessionId": 55, "requestedAt": "2026-10-22T14:03:13+09:00", "answerId": 903,
  "mode": "VIDEO", "persona": "DEVIL", "seq": 3,
  "question": "응답 시간을 40% 줄인 과정은?", "criteria": "원인 분석 · 수치 근거",
  "content": "조회 쿼리 실행 계획을 보고…", "tokens": [ { "text": "조회", "startMs": 0, "endMs": 280 } ],
  "speech": { "trailingOffRatio": 12.5, "pitchRangeSt": 6.2 } }
```

### 1.4 결과 메시지 (AI → BE) **[제안]**

- 큐는 Redis List `ai:results`다. AI가 `LPUSH`하고, BE는 `BLMOVE ai:results ai:results:processing RIGHT LEFT`로 꺼내 저장한 뒤 처리 중 리스트에서 지운다(BE가 멈춰도 메시지가 남음)
- BE가 저장할 수 없는 메시지(JSON 아님, 모르는 `type`, 필수 필드 없음, 질문이 5개가 아님 등)는 `ai:results:failed`에 원문 그대로 모아 둔다. 결과가 반영되지 않으면 여기를 확인한다
- 그룹 면접의 면접 에이전트 결과는 별도 큐 `ai:results:group`(처리 중 `ai:results:group:processing`)으로 보낸다 **[결정]**. 차례 전환이 결과 생성 저장 같은 무거운 처리 뒤에 줄 서지 않게 하기 위해서다. 형식 · 실패 목록(`ai:results:failed`)은 같다. 분석 작업자 결과는 그룹 면접도 `ai:results`로 보낸다. 그룹 면접에서 늘거나 바뀌는 결과 메시지는 6.7
- 공통 필드: `type`, `sessionId`, `jobId`(작업에서 나온 결과만. 받은 작업의 `jobId`를 그대로 담는다), `occurredAt`(ISO 8601, 밀리초까지. 배정 거절은 면접 시작 직후에 전송되어 BE가 면접 시작 시각과 비교하므로 초 단위로 자르지 않는다)

| `type` | 보내는 쪽 | 내용 | BE가 하는 일 |
|---|---|---|---|
| `plan.progress` | 분석 작업자 | `progress`(50 등) | `planProgress` |
| `plan.completed` | 분석 작업자 | `claims`, `questions`, `promptVersion`, `modelVersion`(2장) | 질문 보관함에 추가(2장, 그룹 면접 제외)한 뒤 `interview_plans` 저장(개인 면접은 보관함에서 배정한 질문 5개와 지원서 주장, 2장), `planStatus: READY` |
| `plan.failed` | 분석 작업자 | `reason`(아래 실패 이유) | `planStatus: FAILED` |
| `claims.extracted` | 분석 작업자 | `applicationId`, `claims`, `promptVersion`, `modelVersion`(2장) | 지원서 주장이 없을 때만 주장과 버전을 `application_claims`에 저장하고, 그 지원서에서 주장을 기다리는 면접의 PLAN 작업 등록 |
| `claims.extractFailed` | 분석 작업자 | `applicationId`, `reason`(아래 실패 이유) | 그 지원서에서 주장을 기다리는 면접을 `planStatus: FAILED`로 변경 |
| `answer.scored` | 분석 작업자 | `answerId`, `evaluation`(3장) | `answers.evaluation`이 비어 있을 때만 저장 |
| `evaluation.progress` | 분석 작업자 | `analysisStep` | `analysisStep` |
| `evaluation.completed` | 분석 작업자 | 4장(`headline`·`summary` 포함) | 한 트랜잭션으로 저장, `COMPLETED`, `analysisStep` 비움 |
| `evaluation.failed` | 분석 작업자 | `reason`(아래 실패 이유) | `FAILED` |
| `recording.merged` | 분석 작업자 | `objectKey`(합친 mp4), `recordingStartedAt`(영상 0초 시각, 없으면 null) | `recordings` 저장 |
| `recording.mergeFailed` | 분석 작업자 | `reason`(아래 실패 이유) | BE는 다시보기에서 `videoStatus: FAILED`로 응답한다(API 명세 6.4) |
| `question.started` | 면접 에이전트 | `seq`, `startedAt`, `content`, `criteria`, `promptVersion`, `modelVersion`(6.2) | `interview_questions` 생성(`created_at` = `startedAt`, 질문 글·채점 기준·버전 저장). 출제한 질문이 보관함 질문이면 사용 처리(2장) |
| `answer.completed` | 면접 에이전트 | `seq`, `answerStartedAt`, `content`, `tokens`, `speech`, `endReason`(6.2) | `answers` 저장(`speech`는 `answers.speech`), SCORE_ANSWER 작업 등록 |
| `assignment.rejected` | 면접 에이전트 | `reason`(아래 실패 이유의 `INVALID_ASSIGNMENT`) | 면접이 `IN_PROGRESS`이고 질문 행이 없을 때만 면접방을 닫고 `START_FAILED`로 변경한다. 그 밖에는 폐기한다 |
| `room.closed` | 면접 에이전트 | (공통 필드만) | 지원자가 모두 떠나 LiveKit이 면접방을 닫았다(6.5). 개인 면접이 `IN_PROGRESS`이면 끝내기(API 명세 5.8)와 같이 끝낸다(답변이 있으면 `ANALYZING`, 없으면 `ABORTED`, 시선 비율은 비움). 그 밖에는 폐기한다 |

**실패 이유(`reason`)** 실패 결과 메시지는 아래 값 중 하나를 담는다. BE가 값으로 처리를 나눌 수 있도록 자유 문장을 사용하지 않는다.

| 값 | 결과 메시지 | 뜻 |
|---|---|---|
| `GMS_UNAVAILABLE` | `plan.failed` · `claims.extractFailed` · `evaluation.failed` | GMS 호출이 재시도 후에도 실패했거나 재시도 대상이 아닌 오류 응답을 수신함(5장) |
| `INVALID_OUTPUT` | `plan.failed` · `claims.extractFailed` · `evaluation.failed` | GMS 출력이 재시도 후에도 검증을 통과하지 못함(2·5장) |
| `TIMED_OUT` | `plan.failed` · `claims.extractFailed` · `evaluation.failed` | BE 최대 대기 시간을 넘음(5장) |
| `TRACK_NOT_FOUND` | `recording.mergeFailed` | 원본 위치에 트랙 파일이 없음(7장) |
| `STORAGE_ERROR` | `recording.mergeFailed` | 녹화 저장소에서 다운로드하거나 업로드하지 못함 |
| `MERGE_ERROR` | `recording.mergeFailed` | ffmpeg가 트랙을 합치지 못함. 그룹 면접은 녹화 시작 시각을 얻지 못해 구간을 자를 수 없을 때도 사용함(7장) |
| `INVALID_JOB` | 네 작업 실패 메시지 모두 | 작업 메시지 형식이 틀림(1.3) |
| `INVALID_ASSIGNMENT` | `assignment.rejected` | 배정 정보 형식이 틀림(6.1) |
| `INTERNAL_ERROR` | 네 작업 실패 메시지 모두 | 그 밖의 예상하지 못한 오류. 원인은 작업자 로그에 남김 |

**중복 · 늦은 결과는 BE가 거른다**

| 경우 | 예 | 처리 |
|---|---|---|
| 중복 수신 | 같은 `answer.completed`가 두 번 | 「질문 하나에 답변 하나」(`answers.question_id` UNIQUE)로 두 번째는 버림 |
| 중복 수신 | 같은 `answer.scored`가 두 번 | `evaluation`이 이미 있어 버림 |
| 중복 · 순서 역전 | 같은 `assignment.rejected`가 두 번, 질문을 시작한 뒤 도착, 또는 다시 시작(5.4)한 뒤 이전 시도의 거절이 도착 | 면접이 이미 `START_FAILED`이거나 질문 행이 있거나 `occurredAt`이 면접 시작 시각보다 이르면 폐기 |
| 중복 · 순서 역전 | 같은 `room.closed`가 두 번, 또는 다시 시작(5.4)한 뒤 이전 시도의 방 닫힘이 도착 | 면접이 이미 `IN_PROGRESS`가 아니거나 `occurredAt`이 면접 시작 시각보다 이르면 폐기 |
| 순서 역전 | 첫 질문 기한 초과(6.5)로 다시 시작(5.4)한 뒤 이전 시도의 `question.started`가 도착 | `startedAt`이 면접 시작 시각보다 이르면 폐기 |
| 중복 수신 | 같은 `plan.completed`가 두 번 | 질문 보관함에는 한 번만 넣음 |
| 중복 수신 | 같은 지원서의 `claims.extracted`가 두 번(같은 작업의 중복, 또는 5.1·5.3이 다시 요청한 작업) | 지원서 주장이 이미 있으면 폐기 |
| 순서 역전 | 5.3 재생성 뒤 실패했던 이전 PLAN의 결과가 늦게 도착 | `planStatus`가 `GENERATING`이 아니거나 `interview_plans` 행이 이미 있으면 폐기. 폐기한 결과의 질문은 질문 보관함에도 넣지 않음 |
| 순서 역전 | 5.9 재생성 뒤 이전 EVALUATE 결과가 늦게 도착 | `status`가 `ANALYZING`이 아니면 버림. 같은 `ANALYZING` 안에서 이전 시도와 구분하려면 BE가 마지막으로 보낸 `jobId`와 비교한다 **[제안]** |

## 2. PLAN: 질문·채점 기준 만들기

면접 전에 자소서에서 주장을 뽑고, 그 주장을 파고드는 질문 5개와 질문마다 채점 기준 1개를 만든다.

- **시작** 5.1·5.3
- **입력(작업 메시지)** `companyName`, `jobTitle`, `coverLetterItems`(자기소개서 문항 1~5개를 문항 순서대로, 문항마다 `question`·`answer`. API 명세 4.1), `persona`, `companyCard`(8장, 없으면 생략), `questionCount`(그룹 면접의 개인 맞춤 질문이면 2, 없으면 5), `claims`(개인 면접이면 저장된 지원서 주장, 아래 STEP 01. 그룹 면접은 생략), `askedQuestions`(개인 면접이면 같은 지원서·같은 면접관의 면접에서 출제한 보관함 질문마다 `content`·`claimId`. 꼬리질문은 넣지 않는다. 없거나 그룹 면접이면 생략)
- **그룹 면접** **[결정]** `questionCount`가 2면 질문 2개(`seq` 1~2)를 만든다. 둘 다 그룹 면접에서 본인 차례에 그대로 출제하는 개인 맞춤 질문이고 예비 질문이 아니다. 주장 추출 · 면접관별 질문 수준 · 근거 검사 · 회사 카드 사용은 같고, 회사 정보와 연결하는 질문 수만 0~1개로 줄인다. 아래 "5개"는 `questionCount`로 읽는다. 개인 면접은 `questionCount`를 보내지 않아 지금과 같다
- **STEP 01 주장 추출(GMS)** 자소서에서 경험·수치를 뽑는다. `sentenceNo`는 자소서의 문장 순번(1부터)이다. 문항 순서대로 문항 질문과 답변을 같은 규칙으로 나눠 이어서 센다(질문은 보통 한 문장). V13 전에 만든 플랜은 문항으로 옮기기 전 자기소개서 글 하나로 셌다. 옮기며 1번 문항에 붙은 질문 줄('자기소개서')이 없으므로 지금 문항 기준 번호와 그 줄만큼 어긋난다
  - 문장은 비어 있지 않은 줄마다 나누고, 줄 안에서는 한글·영문·닫는 괄호·%·따옴표 바로 뒤의 마침표·물음표·느낌표(그 뒤에 닫는 따옴표·괄호가 붙을 수 있음) 다음 공백에서 나눈다
  - 숫자 뒤 마침표(「1. 지원 동기」 같은 번호)에서는 나누지 않는다
  - 주장마다 `talentCriteria`에 아래 인재상 기준 12개 중 그 주장에 드러난 기준 이름을 0~2개 담는다. 면접관별로 사용할 주장과 회사 인재상 항목의 연결 후보를 정하는 데 사용한다
  - 개인 면접은 주장을 지원서마다 한 번 추출한다. 주장 추출은 회사명·직무·자기소개서만 입력으로 사용하고, 지원서 수정 API가 없어 자기소개서가 변경되지 않기 때문이다(API 명세 4장)
  - BE는 지원서를 저장(API 명세 4.1)한 뒤 주장 추출 작업 EXTRACT_CLAIMS(입력 `applicationId`·`companyName`·`jobTitle`·`coverLetterItems`)를 요청하고, `claims.extracted`의 `claims`(근거 검사를 통과한 주장)와 `promptVersion`·`modelVersion`을 지원서 주장으로 저장한다. 개인 면접의 PLAN은 저장된 주장을 입력 `claims`로 수신하고 주장을 추출하지 않는다
  - 주장 추출 프롬프트 버전은 `extract-claims-v1`(9장)
  - 면접 생성(5.1)·다시 만들기(5.3) 때 지원서 주장이 없으면 BE는 주장 추출을 다시 요청하고, 주장을 저장한 뒤 PLAN을 요청한다. 추출이 진행 중인지는 따로 관리하지 않는다(중복 결과는 1.4)
  - 그룹 면접은 지금처럼 PLAN 안에서 주장을 추출하고, 지원서 주장을 저장하지도 사용하지도 않는다
- **STEP 02 질문·기준 생성(GMS)** 주장마다 파고드는 질문과 채점 기준을 JSON으로 생성한다. 질문 수 5개가 우선이다. 주장이 5개보다 적으면 같은 주장을 다른 관점으로 질문하고, 많으면 검증 가치가 큰 주장을 선택한다
  - `askedQuestions`가 있으면 그 질문과 같은 질문은 만들지 않는다. 같은 주장을 다른 측면으로 묻는 질문은 만든다
- **면접관별 질문 수준** 같은 자소서라도 면접관에 따라 면접 종류가 다르다. 질문 수·형식·근거 검사는 같다

  | 면접관 | 면접 종류 | 묻는 것 | 묻지 않는 것 |
  |---|---|---|---|
  | `COFFEE_CHAT` 개발자 면접관 | 실무면접 | 아래 인재상 기준 중 개발자 면접관 기준. 신입이 자기 경험으로 답할 수 있는 수준 | 라이브러리 내부 구현, 수치·명령어 암기, 코드 작성 |
  | `DEVIL` 악마 면접관 | 임원면접 | 아래 인재상 기준 중 악마 면접관 기준. 자소서 주장의 약점을 짚는 압박 방식으로 묻는다 | 기술 세부 구현, 출신 지역·가족·외모 등 직무와 무관한 개인 사항 |
  | `DUCK` 오리 면접관 | 자신감 연습 면접 | 아래 인재상 기준 12개 중 자소서에 드러난 것. 실무면접 기준과 임원면접 기준을 섞어, 자소서에 작성한 경험을 편하게 설명할 수 있는 말투로 질문한다 | 약점을 짚는 압박 표현, 라이브러리 내부 구현, 수치·명령어 암기, 코드 작성, 직무와 무관한 개인 사항 |

  - 실제 기업 면접도 실무면접에서 직무 역량과 경험을, 임원면접에서 인성과 조직 적합도를 확인하므로 두 면접관을 이 두 면접에 맞춘다
  - 면접관별 인재상 기준은 다음과 같다

    | 기준 | 개발자 면접관(실무면접, 15년 차 실무 팀장) | 악마 면접관(임원면접) |
    |---|---|---|
    | 전문성·성장 | 경험한 기술의 구조(구성 요소의 역할, 데이터 흐름, 설계를 선택한 이유와 대안, 변경 시 영향 범위), 새로 배운 것과 배운 방법 | — |
    | 도전·혁신 | 새로운 시도·기술 도입의 이유, 대안, 결과 | — |
    | 실행·성과 | 성과 수치의 근거와 본인 역할 | — |
    | 고객·사용자 중심 | 기술 선택·구현이 사용자 경험에 준 영향(예: 시스템 지연) | — |
    | 유연·적응·개방 | 요구사항·환경 변화에 대응한 방법 | — |
    | 성실·정확·품질 | 오류를 줄이거나 품질을 확인한 방법 | — |
    | 정직·윤리·공정 | — | 성과와 원칙이 부딪힌 상황에서의 판단 |
    | 책임·주도성 | — | 실패·위기에서 본인이 진 책임과 그 뒤의 행동 |
    | 협력·소통 | — | 의견이 다른(갈등) 사람과 일한 방식 |
    | 존중·배려 | — | 동료·상대를 대한 태도 |
    | 글로벌·다양성 이해 | — | 배경이 다른 사람과 일한 경험 |
    | 사회적 책임·공공성 | — | 일이 사회·공공에 미치는 영향에 대한 생각 |

    - 기준은 기업 인재상 문구를 12개 가치로 분류한 것이다. 기술과 일하는 방식에 관한 가치는 실무면접, 태도와 가치관에 관한 가치는 임원면접에서 확인한다
    - 자소서에 드러난 기준만 질문하고, 드러나지 않은 기준은 질문하지 않는다
    - 악마 면접관의 압박은 질문 문장의 어조와 표현 방식(자소서 주장의 약점을 짚는 말투)이다. 질문 생성 기준과 답변 피드백 기준(직무 적합·논리·전달)은 바꾸지 않는다
    - 오리 면접관은 면접 자신감 향상이 목적이므로 기준을 나누지 않고 12개 기준을 모두 사용한다
  - 임원면접의 압박 질문은 자소서 주장의 약점을 근거로 삼는다
  - 지원자를 비하하거나 단정하는 표현, 자소서에 없는 사실을 전제로 한 질문은 하지 않는다
- **회사 카드 사용** `companyCard`가 있으면 질문 생성에 다음처럼 사용한다. 질문은 자소서 주장을 검증하는 것이 기본이고, 카드에 없는 회사 정보를 전제로 질문하지 않는다
  - 면접관별로 사용하는 항목은 악마 면접관 `talent`·`recent`, 개발자 면접관 `direction`·`market`·`recent`, 오리 면접관 `talent`·`direction`·`market`·`recent`다
  - 연결 후보는 카드 항목의 분류값(8장)으로 코드가 선별한다
    - `talent`(회사 인재상) 항목은 `criterion`이 주장의 인재상 기준 `talentCriteria`(STEP 01)에 있는 주장만 후보다
    - `direction`·`market`·`recent`(사업 방향·시장·최근 이슈) 항목은 `ncs_subcategories`에 지원 직무의 NCS 세분류가 있을 때만 후보다. 지원 직무명(`jobTitle`)은 코드가 NCS 세분류로 변환한다
    - 모델은 후보 중 자소서 경험과 회사 항목이 실제로 관련된 쌍만 연결하고, 관련된 쌍이 없으면 연결하지 않는다
  - 질문 형식은 연결한 항목에 따라 정한다
    - `talent` 항목에 연결한 질문과 회사 정보와 연결하지 않은 질문은 과거 경험 질문이다. 자소서 경험에서 본인이 한 행동과 그 결과를 묻는다
    - `direction`·`market`·`recent` 항목에 연결한 질문은 가정 상황 질문이다. 회사 항목의 원문을 인용해 제시하고, 자소서 경험의 방법을 그 상황에 어떻게 적용할지 묻는다
    - 회사 항목에 연결한 질문의 문장에는 그 항목의 내용이 포함되어야 한다
    - 회사 항목에 연결한 질문의 채점 기준(`criteria`)에는 그 항목의 내용을 좋은 답변이 갖춰야 할 내용으로 포함한다. 지원자가 회사 이름이나 회사 항목을 직접 말하도록 요구하지 않는다
    - 회사의 사건을 기준으로 지원자 경험이 충분한지 평가하는 질문과, 회사 내부 사정을 알아야 답할 수 있는 질문은 하지 않는다
  - 동기 검증: 악마 면접관이 자소서의 회사 관련 내용이 카드(`talent`·`direction`·`market`·`recent`)와 명백히 다를 때만 묻는다. `recent`(최근 이슈)는 자소서가 그 이슈를 언급한 경우에만 대조한다
  - 카드가 없거나 해당 항목이 비어 있으면 그 항목을 사용하지 않고 기존 방식으로 질문한다
  - 질문 5개 중 회사 정보와 연결하는 질문은 모든 면접관 0~2개다. 연결한 질문 수가 어긋나거나 카드에 없는 항목 또는 후보가 아닌 쌍을 가리키면 질문 5개를 1회 다시 생성하고, 그래도 어긋나면 그대로 사용한다

```json
{
  "claims": [
    { "id": "c1", "text": "조회 응답 시간을 40% 줄였다", "type": "NUMBER", "sentenceNo": 4, "talentCriteria": ["실행·성과"] }
  ],
  "questions": [
    { "seq": 1, "content": "응답 시간을 40% 줄인 과정은?", "criteria": "원인 분석 · 수치 근거", "claimId": "c1", "companyItem": null },
    { "seq": 3, "content": "「배송·결제 속도가 경쟁 요소」인 상황에서 조회 개선 경험을 어떻게 적용하겠습니까?", "criteria": "배송·결제 속도가 경쟁 요소인 상황의 문제 정의 · 적용 방법과 이유 · 확인 방법", "claimId": "c1",
      "companyItem": { "section": "market", "summary": "배송·결제 속도가 경쟁 요소", "quote": "…", "source": "최신 사업보고서 II. 사업의 내용", "ncs_subcategories": ["응용SW엔지니어링"] } }
  ]
}
```

- `type`: `EXPERIENCE`(경험) · `NUMBER`(수치). `questions`는 `seq` 1~5로 정확히 5개
- `companyItem`: 질문을 연결한 회사 항목이다. `section`에 카드 칸 이름(`talent`·`direction`·`market`·`recent`)을, 나머지에 그 카드 항목의 칸을 카드에 있는 이름 그대로 담는다. 회사 정보와 연결하지 않은 질문은 null이다
- **면접관별 주장 선택** 주장의 인재상 기준 `talentCriteria`(STEP 01)가 그 면접관 기준(위 표)과 하나 이상 겹치는 주장만 STEP 02에 넘긴다. 겹치는 주장이 하나도 없으면 모든 주장을 넘긴다
- **검증** JSON이 아니거나 질문이 5개가 아니면 1회 재시도 후 `plan.failed`. `claimId`가 STEP 02에 넘기지 않은 주장을 가리키면 그 질문만 1회 다시 만들고, 그래도 틀리면 `plan.failed`
- **근거 검사** 주장 추출(STEP 01)에서 한다. 개인 면접은 주장 추출 작업(EXTRACT_CLAIMS), 그룹 면접은 PLAN 안의 STEP 01이다. 주장의 수량 표현마다 같은 값이 그 주장의 근거 문장(`sentenceNo`)에 있을 때만 주장을 유지한다. 근거 문장에 없는 수치를 전제로 질문하지 않기 위함이다
  - 숫자는 값으로 비교한다(6.0과 6, 1,100과 1100은 같음). 단위는 비교하지 않는다
  - 숫자 없는 수량 표현(「절반」, 「두 배」, 「3분의 1」 등)도 같은 값으로 인정한다(「절반」 = 50%, 「두 배」 = 200%). 주장이 「50%」이고 원문이 「절반」인 경우도 같다
  - 남는 주장이 없으면 출력 구조 깨짐과 같이 처리한다(5장)
- **진행률** STEP 01이 끝나면 `plan.progress`(50), STEP 02가 끝나면 `plan.completed`. 개인 면접은 주장을 입력으로 수신하므로 PLAN을 시작할 때 `plan.progress`(50)를 전송한다
- **결과** `plan.completed`에 위 JSON과 `promptVersion`·`modelVersion`을 담는다. 개인 면접의 `claims`는 입력으로 수신한 주장 그대로다. `modelVersion`은 GMS 응답에 실린 모델 이름이다(9장). BE가 `interview_plans(session_id PK·FK, claims, questions, prompt_version, model_version, created_at)`에 저장한다
- **질문 출제** 질문 5개와 채점 기준·연결 회사 항목은 BE가 5.4에서 면접 에이전트 배정 정보로 전달한다(6.1). 1·3번은 그대로 출제하고, 2·4·5번은 꼬리질문(2.2)을 생성하지 못했을 때 출제하는 예비 질문이다. `interview_questions` 행은 에이전트가 질문을 말하기 시작할 때(`question.started`) 실제로 출제한 질문 글로 BE가 만든다. 질문 수는 5개 고정이다. 그룹 면접은 개인 맞춤 질문 2개를 그대로 출제하고 예비 질문이 없다(6.7)
- **질문 보관함** BE는 `plan.completed`로 수신한 질문을 「지원서 + 면접관(`persona`)」마다 하나인 보관함에 질문 하나당 한 행으로 저장한다. 꼬리질문이 대신 출제되어 출제하지 않은 예비 질문을 같은 지원서·같은 면접관의 다음 면접에서 다시 사용하기 위함이다
  - 행마다 질문의 `content`·`criteria`·`claimId`·`companyItem`과 그 질문을 만든 `promptVersion`·`modelVersion`을 저장한다
  - 그룹 면접의 질문은 보관함에 넣지 않는다. 그룹 면접은 개인 맞춤 질문을 매번 생성하고 예비 질문이 없기 때문이다(6.7)
  - 면접 생성(5.1)·다시 만들기(5.3) 때 보관함 질문이 5개 미만이면 BE는 PLAN을 요청해 질문 5개를 새로 생성한다
  - 출제 자리 배정: BE는 보관함에서 사용 처리되지 않은 질문 5개를 골라 면접 계획의 `seq` 1~5에 둔다. 보관함 질문이 5개 이상이면 면접 생성·다시 만들기 때 바로, 모자라면 `plan.completed`로 보관함에 추가한 뒤 배정한다
    - 생성한 날이 이른 질문을 먼저 고르고, 같은 날 생성한 질문은 저장 순서대로 고른다
    - 1번은 가장 오래된 질문, 3번은 남은 질문 중 가장 오래된 회사 연결 질문(`companyItem`이 있는 질문. 없으면 남은 질문 중 가장 오래된 질문), 2·4·5번은 남은 질문 중 오래된 순서다
    - 배정한 질문 5개와 지원서 주장(`claims`)으로 `interview_plans` 행을 만든다. 면접 시작(5.4)의 배정 정보와 결과 생성(4장)이 이 행을 읽는다. 배정한 질문들의 버전을 면접 계획의 버전(`prompt_version`·`model_version`)으로 저장한다
  - 사용 처리: 배정할 때는 예약하지 않고, `question.started`로 실제로 출제한 보관함 질문만 사용 처리한다. 1·3번은 항상 보관함 질문이고, 2·4·5번은 꼬리질문 대신 예비 질문을 출제했을 때(`promptVersion`이 null, 2.2)만 보관함 질문이다. 사용 처리한 질문은 다시 배정하지 않는다
  - 폐기: BE는 아래 질문을 보관함에서 폐기하고 배정하지 않는다
    - 면접 생성(5.1)·다시 만들기(5.3) 때 보관함 질문 수를 집계하기 전에, 최근 이슈(`recent`)에 연결한 질문은 연결 항목의 기사 날짜(`published`)로부터 30일이 지났으면 폐기한다
    - 같은 때, 인재상(`talent`)·사업 방향(`direction`)·시장(`market`)에 연결한 질문은 연결 항목과 같은 항목이 면접을 만들 때 찾은 최신 회사 카드의 같은 칸에 없으면 폐기한다. `section`을 제외한 `companyItem`의 칸이 카드 항목의 칸과 모두 같을 때 같은 항목이다
    - 회사 정보와 연결하지 않은 질문은 위 두 기준으로 폐기하지 않는다
    - `plan.completed`를 수신하면 보관함에 추가하기 전에, 같은 보관함의 미사용 질문 중 수신한 결과와 `promptVersion`이 다른 질문을 폐기한다
- **버전** 프롬프트 버전은 개인 면접 `plan-v8`, 그룹 면접(`questionCount` 2) `plan-group-v1`(9장). 그룹 면접은 질문 수와 회사 정보 연결 질문 수만 다른 프롬프트이므로 버전을 나눈다. 개인 면접 버전을 올리면 BE가 버전이 다른 미사용 보관함 질문을 폐기하기 때문이다

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

### 2.2 꼬리질문

면접 중에 직전 기본 질문의 답변을 파고드는 질문을 면접 에이전트가 GMS로 생성한다. 미리 만든 질문만으로는 지원자의 답변 내용에 따라 질문이 달라지지 않기 때문이다.

- **출제 순서** 질문 수는 5개로 유지한다

  | 순서 | 질문 | 생성 시점 |
  |---|---|---|
  | 1 | 기본 질문(플랜 `seq` 1) | 면접 전(2장) |
  | 2 | 꼬리질문 | 1번 답변이 끝난 직후 |
  | 3 | 기본 질문(플랜 `seq` 3) | 면접 전(2장) |
  | 4·5 | 꼬리질문 2개 | 3번 답변이 끝난 직후 한 번에 |

  - 4·5번은 3번 답변의 서로 다른 측면을 묻는다. 한 번에 생성하는 것은 두 질문이 겹치지 않게 하고 5번 질문 앞에서 기다리지 않게 하기 위함이다
- **입력** 면접관(`persona`), 직전 기본 질문의 글·채점 기준, 그 답변 글(화상은 `answer.completed`의 `content`, 채팅은 `answer.submit`의 `content`, 6.3), 직전 기본 질문의 연결 회사 항목(배정 정보의 `companyItem`, 6.1. 연결하지 않은 질문이면 null)
- **출력** 질문마다 `content`(질문 글)·`criteria`(채점 기준). 답변 채점(3장)은 출제한 질문의 채점 기준을 사용한다
- **생성 지침**
  - 한 질문에서 한 가지만 묻는다
  - 답변, 직전 질문, 그 질문의 연결 회사 항목에 없는 사실을 전제로 질문하지 않는다
  - 직전 기본 질문에 연결 회사 항목이 있으면 답변에서 그 회사 항목과 관련된 지점을 파고들 수 있다
  - 면접관별 질문 수준과 인재상 기준은 2장과 같다. 악마 면접관의 압박 어조는 쓰지 않는다. 압박 어조를 지시하면 답변에 없는 부정적 사실을 전제로 묻기 때문이다
- **검증** JSON이 아니거나, 질문 수가 맞지 않거나, 질문 글·채점 기준이 비어 있으면 생성 실패로 처리한다. 기다리는 시간이 짧으므로 재시도하지 않는다
- **예비 질문** 답변이 끝난 시점부터 4초(임시 값) 안에 생성하지 못하거나 생성에 실패하면 같은 순서의 미리 만든 질문(2장)을 출제한다. 4·5번은 함께 생성하므로 함께 예비 질문으로 대체한다. 직전 답변을 전송하지 않았으면(6.5 저장할 수 없는 답변) 생성하지 않고 예비 질문을 출제한다
  - 4초는 실측(`gpt-5.6-terra`, 1개 1.5~2.8초·2개 2.1~2.3초, 각 3회)의 최댓값에 여유를 둔 값이다. 질문 음성 합성 시간은 포함하지 않으며, 별도로 0.5~1.7초(57자 질문, 3회)가 걸린다
- **버전** 프롬프트 버전은 `followup-v2`, 모델은 PLAN과 같다(9장). 생성한 질문은 `question.started`에 `promptVersion`·`modelVersion`을 담고, 예비 질문은 둘 다 null이다

## 3. SCORE_ANSWER: 답변 채점

면접 중 답변마다 말하기 분석과 평가 STEP 01(기준별 판정)을 미리 한다. 다음 질문을 막지 않고, 실패해도 면접은 계속된다(EVALUATE가 마저 채점).

- **시작** BE가 답변을 저장한 직후(화상은 `answer.completed`, 채팅은 5.7). `answers.evaluation`이 비어 있을 때만 작업을 넣는다
- **입력(작업 메시지)** `answerId`, `mode`, `persona`, `seq`, `question`, `criteria`, `content`, `tokens`(화상), `speech`(화상, `answers.speech`), `sttGaps`(화상, `answer.completed`의 `sttGaps`, 6.2) **[제안]**. 회사 카드(8장)는 아직 받지 않는다
- **말하기 분석(화상만)** 입력은 `tokens`와 작업 메시지의 `speech`
  - 말하기 지표는 답변마다 구하는 5개(군말·긴 멈춤·말 속도·말끝 흐림·억양 폭, API 명세 6.3 `speechMetrics`에서 `gazeRatio`를 제외한 것)다. 시선 비율은 AI가 계산하지 않는다(화면이 브라우저에서 재어 BE에 보낸다, API 명세 5.8)
  - `tokens`의 글자를 이어 붙인 뒤 공백을 경계로 단어로 묶는다. 단어 시각은 첫 토큰의 `startMs`부터 마지막 토큰의 `endMs`까지다. 문장 부호만 있는 토큰(`.`·`,` 등)은 단어 끝 시각에 넣지 않는다. Soniox가 문장 중간 멈춤 뒤의 시각에 문장 부호를 두어, 넣으면 멈춘 시간이 단어 안에 들어가기 때문이다
  - `tokens`로 군말 수·말한 시간·긴 멈춤 수·말 속도를 구한다
  - 말끝 흐림·억양 폭은 면접 에이전트가 답변을 듣는 동안 실시간 음성으로 계산해 `answer.completed`로 전송한 값(6.2)을 그대로 사용한다. 답변 음성 파일은 사용하지 않는다
  - `tokens`가 없거나 구하지 못한 지표는 비워 둔다
  - `sttGaps` 구간은 STT가 음성을 인식하지 못해 단어가 비어 있는 것이므로, 그 구간과 겹치는 쉼은 긴 멈춤으로 세지 않고 말한 시간에서도 제외한다

| 지표(`speech` 키) | 계산 |
|---|---|
| 군말 수 `fillerCount` | 단어에서 문장부호를 뺀 글이 망설임 소리(음·어·아·에·으·흠, 같은 글자를 늘인 "음음"·"어어" 포함)면 센다. 담화 표지(그·저·이제·뭐·막·약간·좀·그냥·그러니까·이렇게·뭔가)는 단어 끝에 쉼표·마침표·말줄임표가 붙어 혼자 끊길 때만 센다("그 사람"의 "그"는 세지 않는다) |
| 긴 멈춤 수 `longPauseCount` | 문장 중간에서 앞 단어 끝부터 다음 단어 시작까지 2초 이상 쉰 횟수. 앞 단어가 문장 끝([API 명세 면접방 메시지](API-명세.md#면접방-메시지-livekit)의 종결어미 기준)이면 문장 사이 쉼이라 세지 않는다. 화상 답변 끝 판단(7초)과는 다른 기준이다 |
| 말한 시간 `speakingMs` | 첫 단어 시작부터 마지막 단어 끝까지에서 긴 멈춤 시간을 뺀 값(밀리초) |
| 말 속도 `syllablesPerMin` | 한글 음절 수 ÷ 말한 분(정수로 반올림). 영문·숫자는 세지 않는다. 말한 시간이 0이면 비워 둔다 |
| 말끝 흐림 비율 `trailingOffRatio` | (에이전트) 문장마다 마지막 어절 구간의 평균 음량이 그 문장 발화 구간의 평균 음량보다 6dB 이상 낮으면 흐린 문장으로 집계한다. 흐린 문장 수 ÷ 문장 수 × 100(%, 소수 둘째 자리). 문장 경계는 긴 멈춤과 같은 종결어미 기준이고, 종결어미 없이 끝난 마지막 부분도 한 문장으로 본다 |
| 억양 폭 `pitchRangeSt` | (에이전트) 발화 구간에서 구한 음 높이(기본 주파수)의 하위 5% 값과 상위 95% 값으로 12 × log2(상위 ÷ 하위)를 계산한다(반음, 소수 둘째 자리) |

군말 목록과 2초는 로컬 실측(조용한 곳에서 망설임 소리·담화 표지가 모두 전사됨) 결과와 한국어 구어의 군말·쉼 쓰임을 근거로 정한 초안이다. 면접 단위 집계는 4장 `speech_metrics` 집계를 따른다.

- **말끝 흐린 문장의 끝 시각 `trailingOffAtMs`** **[제안]** (에이전트) 말끝 흐림 비율을 구할 때 흐린 문장으로 집계한 문장의 마지막 단어 끝 시각(`answerStartedAt` 기준 밀리초) 목록이다. 시각 순이고, 흐린 문장이 없으면 빈 목록, 비율을 구하지 못했으면 null이다. 문장 경계·말끝 흐림 판정은 위 표와 같다. 다시보기 타임라인에서 말끝을 흐린 곳을 짚기 위해 남기며, 판정 입력과 면접 단위 집계에는 쓰지 않는다. 문장 경계는 `tokens`로 다시 구할 수 있지만 흐렸는지는 실시간 음성으로만 알 수 있어 따로 남긴다
- 작업 메시지의 `speech`에는 `trailingOffRatio`·`pitchRangeSt`만 담는다. 타임라인용 값(`trailingOffAtMs`·`impressions`)은 채점에 쓰지 않기 때문이다

- **판정 입력** 질문, 채점 기준, 답변 글. 화상은 `DELIVERY` 판정에 그 답변의 말하기 지표를 더한다. `sttGaps`가 있으면 그 위치에서 음성이 인식되지 않았다는 것을 함께 넣고, 그 앞뒤의 말 중단·반복은 감점 근거로 삼지 않는다. 지원자가 일으킨 것이 아니기 때문이다
- **판정** 채점 기준을 잣대로 평가 항목 4개를 3단계로 판정한다(G-Eval)
  - 항목마다 판정 이유와 3단계(`level` 1 아쉬워요 · 2 보통 · 3 좋아요)를 받는다
  - 점수는 판정한 단계의 점수(50·70·90)를 그대로 쓴다(`FIXED`)
  - 점수 계산 방식은 `evaluation.criteria`의 항목마다 `scoreMethod`로 기록하며 값은 `FIXED`다. 이전에 3단계 확률의 기대값으로 계산해 저장한 채점은 `PROBABILITY`로 남아 있으므로 결과 생성(4장)은 두 값을 모두 받는다
  - `evaluation` 최상위에는 `scoreMethod`를 두지 않는다. 이전 채점은 항목마다 계산 방식이 다를 수 있으므로 항목별 값만 기록한다
  - 판정이 없거나 3단계 밖이면 구조 깨짐으로 보고 재시도한다(5장)
  - 평가 항목·3단계·점수 계산은 면접관과 관계없이 같다. 성장 리뷰(API 명세 7.1)에서 면접관이 다른 면접끼리도 같은 기준으로 비교하기 위함이다
  - 판정 지침도 면접관과 관계없이 같고, `persona`는 판정에 사용하지 않는다. 판정 지침에 면접 종류를 넣으면 판정 이유뿐 아니라 판정 단계도 함께 달라지기 때문이다. 면접관별 인재상 기준은 결과 생성의 피드백 작성(4장 `WRITING_FEEDBACK`)에만 반영한다
  - 판정 지침은 `JOB_FIT`·`LOGIC`에 다음 단계 설명을 포함한다
    - `JOB_FIT` 3: 질문이 확인하는 역량에 대해 본인이 수행한 구체적 행동과 사용한 방법, 그 방법을 선택한 이유를 제시해 경험과 직무 요구를 연결한다
    - `JOB_FIT` 2: 관련 경험과 본인 행동은 제시하지만 방법을 선택한 이유나 직무 요구와의 연결이 누락되어 있다
    - `JOB_FIT` 1: 결과·수치나 일반론만 제시하고 본인이 수행한 행동이나 방법이 없다
    - `LOGIC` 3: 원인(상황) → 조치 → 결과(확인 방법) 순서가 분명하다
    - `LOGIC` 2: 셋 중 하나가 누락되었거나 서로 연결되지 않는다
    - `LOGIC` 1: 셋 중 둘 이상이 누락되었거나 결과만 나열한다
    - 가정 상황 질문은 원인을 문제 정의로, 조치를 적용할 방법과 그 이유로, 결과를 적용 결과를 확인할 방법으로 해석한다
  - `COVER_LETTER`는 여기서 임시 판정하고 EVALUATE에서 확정한다
  - `DELIVERY`는 화상이면 답변 글과 말하기 지표로, 채팅이면 답변 글로 판정한다. 비어 있는 지표는 빼고 판정하고, 지표가 모두 비어 있으면 답변 글로만 판정한다
- 프롬프트 버전은 `score-answer-v3`(9장)
- **결과** `answer.scored`에 `answerId`와 아래 `evaluation`을 담는다. BE는 `answers.evaluation`이 비어 있을 때만 저장한다

```json
{
  "criteria": {
    "JOB_FIT": { "level": 3, "score": 90, "scoreMethod": "FIXED", "reason": "직무 요구 기술과 경험을 연결함" },
    "COVER_LETTER": { "level": 2, "score": 70, "scoreMethod": "FIXED", "reason": "임시 판정" },
    "LOGIC": { "level": 3, "score": 90, "scoreMethod": "FIXED", "reason": "원인 → 조치 → 결과 순서가 분명함" },
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
- **입력(작업 메시지)** `mode`, `persona`, `coverLetterItems`(2장과 같음), `claims`, 답한 질문마다 `answerId`·`seq`·`question`·`criteria`·`content`·`tokens`·`speech`(화상, `answers.speech`의 지표 2개)·`sttGaps`(화상, 3장과 같음)·`timeline`(화상, `answers.speech`의 `trailingOffAtMs`·`impressions`, 아래 다시보기 타임라인)·`evaluation`(SCORE_ANSWER가 이미 채점했으면 그 값, 아니면 null), `earlierSummaries`(같은 회원이 그날(한국 시간) 이 면접보다 먼저 시작해 결과가 나온 면접들의 `summary`, 시작 순. 없으면 빈 배열), `companyCard`(8장, 없으면 생략)
- 답이 없는 질문(중간 종료)은 메시지에 넣지 않는다

| 단계 | 하는 일 |
|---|---|
| `ORGANIZING_ANSWERS` 답변 정리 | `evaluation`이 null인 답변을 3장과 같은 방식으로 채점한다(이미 있는 값은 유지). 화상이면 답변별 지표를 합쳐 `speech_metrics`를 만든다 |
| `SCORING` 기준별 분석 | STEP 02 자소서 대조: 자소서 원문(문항마다 질문 줄 다음 답변, 빈 줄로 이음)·`claims`와 답변을 대조해 근거가 맞는지 확인하고 `COVER_LETTER` 판정을 확정한다. 그다음 답변 점수 = 4항목 평균, 항목 점수 = 답한 질문들의 항목별 평균(정수) |
| `WRITING_FEEDBACK` 피드백 작성 | 답변마다 잘한 점·고칠 점, 항목마다 코멘트(255자 이하), 면접 총평(255자 이하). 잘한 점·고칠 점은 두 관점으로 쓴다. ① 채점 관점(직무 적합·논리·전달)은 짧게 쓴다. ② 면접관 관점은 `persona`에 해당하는 2장 인재상 기준 중 답변에 드러난 것을 중심으로 쓴다. 항목 코멘트는 항목별 채점 관점으로 작성한다. 잘한 점·고칠 점에 그 면접관의 기준 이름이 없거나 그 면접관의 기준이 아닌 인재상 기준 이름이 있으면 1회 재생성하고, 그래도 어긋나면 그대로 사용한다. 점수는 바꾸지 않는다. 오리 면접관은 12개 기준 모두를 면접관 기준으로 보고, 잘한 점을 먼저 구체적으로 작성하고 고칠 점은 다음에 시도할 행동으로 부드럽게 작성한다. 한 줄 총평은 잘한 점을 먼저 언급한다. `sttGaps` 앞뒤의 말 중단·반복은 고칠 점으로 작성하지 않는다(3장 판정 입력과 같은 이유) |

- `evaluation`을 새로 생성하거나 `COVER_LETTER` 판정을 확정할 때도 항목별 `scoreMethod`는 3장 규칙을 따른다. `COVER_LETTER` 점수를 다시 계산하면 해당 항목의 `scoreMethod`도 실제 계산 방식으로 갱신하고, 나머지 항목은 유지한다
- 단계가 바뀔 때마다 `evaluation.progress`를 보낸다
- **결과** `evaluation.completed`에 다음을 담는다 **[제안]**
  - `answers[]`: `answerId`, `score`, `goodPoint`, `improvePoint`, `evaluation`(`COVER_LETTER` 확정본)
  - `sessionScores[]`: `criterion`, `score`, `comment`
  - `speechMetrics`(화상만, 채팅은 null, 아래 집계)
  - `headline`: 결과 화면 맨 위의 한 줄 총평. 잘한 점·고칠 점 전체를 포괄한다. 30자 이내. 넘으면 1회 다시 만들고, 그래도 넘으면 30자로 자른다(BE도 30자를 넘으면 자른다). BE가 `interview_sessions.headline`에 저장하고 6.3·5.13의 `summary`로 준다
  - `summary`: 성장 리뷰의 "다음에 해볼 것". 고칠 점 중 고치기 가장 쉬운 것 또는 고쳤을 때 효과가 가장 큰 것을 선택해 다음 면접에서 해 볼 것을 한두 문장으로 쓰고, `earlierSummaries`가 있으면 그 내용과 이번 면접을 모두 반영해 그날 전체에서 가장 중요한 것을 쓴다. BE는 그날 마지막 면접의 `summary`를 7.1에 보여 준다
- 답변끼리 어긋나는 내용(같은 경험의 수치·역할이 답변마다 다름)은 답변 전체를 함께 보고 해당 답변의 `improvePoint`에 기록한다
- **회사 정보 반영** `companyCard`가 있으면 잘한 점·고칠 점 작성에 다음처럼 사용한다. 카드가 없으면 회사 정보 없이 작성한다
  - 면접관별로 사용하는 항목은 질문 생성과 같다(2장 회사 카드 사용)
  - 답변마다 그 답변의 경험과 실제로 이어지는 회사 항목이 있는지 먼저 판단한다. 회사 정보와 연결하지 않은 질문의 답변도 같다
  - 이어지는 항목이 있으면 고칠 점에 그 회사 항목(회사 인재상 이름이나 회사 상황)을 밝히고, 답변의 경험을 그 회사 상황에 어떻게 연결하면 더 좋은지 구체적인 행동으로 작성한다. 답변이 이미 그 회사 상황과 이어졌으면 잘한 점에서 그 연결을 짚는다
  - 이어지는 항목이 없으면 회사 정보를 작성하지 않는다
  - 회사 인재상 항목은 그 `criterion`이 답변에 드러난 인재상 기준과 같을 때 회사의 인재상 이름으로 작성한다. 인재상 이름을 말하라는 조언이 아니라 그 인재상에 맞는 행동을 보여 주는 방법으로 작성한다
  - 고칠 점은 판정 이유가 지적한 핵심 부족점을 먼저 작성하고, 회사 연결은 그 뒤에 덧붙인다
  - 카드에 없는 회사 사실은 작성하지 않는다
- 프롬프트 버전은 `evaluate-feedback-v8`(9장)
- BE는 한 트랜잭션에서 이 면접의 `session_scores`·`speech_metrics` 행과 `answers`의 점수·피드백을 지우고 다시 쓴 뒤 `COMPLETED`로 바꾼다(5.9로 다시 돌 때 유일성 제약 충돌 방지)
- `grade`는 보내지 않는다. BE가 점수로 계산한다(API 명세 6.3)

**다시보기 타임라인** **[제안]** (화상만) 다시보기(API 명세 6.4)에서 면접 흐름 곡선과, 평소보다 유난히 낮은 지점(체크포인트)의 보완할 점을 보여 주기 위해 `WRITING_FEEDBACK` 단계에서 함께 만든다. 아래 수치는 모두 임시 값이며 실제 면접으로 조정한다.

- **입력** 작업 메시지의 답변마다 `timeline`(`answers.speech`의 `trailingOffAtMs`·`impressions`, 없으면 null)과 `tokens`
- **곡선 `points`** 답변마다 0초부터 1초 간격으로 네 값을 구한다
  - 인상: 그 1초에 찍은 사진 중 `face` 0.5 이상인 판단의 6항목 평균(받지 못한 항목은 뺀다). 없으면 비운다
  - 말끝 흐림·군말: 앞뒤 5초 안에 일어난 횟수. 말끝 흐림은 `trailingOffAtMs`, 군말은 3장 규칙으로 `tokens`에서 구한 단어 시작 시각
  - 긴 멈춤: 앞뒤 5초 안에 시작한 긴 멈춤(3장 규칙, `tokens`)의 멈춘 시간 합(초). 오래 멈출수록 곡선이 더 내려가게 하기 위함이다
  - 네 값을 면접 전체 1초 값들의 평균·표준편차로 표준화한다. 음성 3개는 많을수록 나쁘므로 부호를 뒤집는다. 표준편차가 0이면 0이다. 점수와 횟수처럼 단위가 다른 값을 "그 면접의 평소에서 얼마나 벗어났나"로 같이 보기 위함이다
  - 인상 1/3, 긴 멈춤 1/3, 말끝 흐림·군말 각 1/6로 가중 평균한다(비운 값은 빼고 남은 가중치로 나눈다). 긴 멈춤은 드물게 일어나 1/6로는 한 번 멈춘 곳이 곡선에 드러나지 않아 더 크게 둔다. 이 값을 다시 면접 전체로 표준화한 것이 `value`(소수 둘째 자리)이고 0이 그 면접의 평균이다
- **낮은 체크포인트 `checkpoints`** `value`가 −1.5 이하로 이어진 구간마다 가장 낮은 1초. 서로 10초 이내면 더 낮은 것만 남긴다. 높은 체크포인트는 나중에 더한다
- **이유 `reasons`** 체크포인트 앞뒤 5초에서
  - 인상 6항목 중 표준화 평균이 −1 이하인 항목
  - 말끝 흐림·군말·긴 멈춤 중 1번 이상 있고 표준화 값이 −1 이하인 것(`count`는 앞뒤 5초 안의 횟수. 긴 멈춤도 멈춘 시간이 아니라 횟수다)
  - 하나도 없으면 가장 낮은 값 하나
  - `metric`: `STABILITY` 안정감 · `CONFIDENCE` 자신감 · `EXPRESSION` 의사표현 · `EMOTION` 감정 전달 · `LIKEABILITY` 매력도 · `TRUST` 신뢰도 · `TRAILING_OFF` 말끝 흐림 · `FILLER` 군말 · `LONG_PAUSE` 긴 멈춤
- **문구 `text`** 면접 하나의 체크포인트 전체를 GMS에 한 번 보내 이유마다 보완할 점(100자 이하)을 받는다(프롬프트 `timeline-feedback-v1`). 입력은 질문, 체크포인트 앞뒤 5초에 말한 글, 이유와 횟수다. 실패하거나 형식이 틀리면 이유마다 정해진 문구를 쓴다
- **결과** `answers[].evaluation.timeline` = `{ "points": [ { "atMs", "value" } ], "checkpoints": [ { "atMs", "startMs", "endMs", "value", "reasons": [ { "metric", "count", "text" } ] } ] }`. 시각은 `answerStartedAt` 기준 밀리초이고 `count`는 음성 이유에만 있다(인상은 null). 구할 값이 없는 답변(채팅, 판단·토큰이 모두 없음)은 null이다
- 타임라인 계산·문구 생성이 실패해도 결과 생성을 실패로 처리하지 않는다. 그 면접의 타임라인만 null이다

**`speech_metrics` 집계**

| 컬럼 | `speechMetrics` 키 | 계산 |
|---|---|---|
| `filler_per_min` | `fillerPerMin` | 전체 군말 수 ÷ 전체 말한 분(소수 둘째 자리) |
| `long_pause_count` | `longPauseCount` | 답변별 합계 |
| `speed_deviation_pct` | `speedDeviationPct` | (면접 말 속도 − 265) ÷ 265 × 100(%, 소수 둘째 자리). 면접 말 속도는 답변별 `syllablesPerMin`(3장)을 발화 시간(`speakingMs`)으로 가중한 평균이고, 265는 일반 성인의 대화 말 속도(음절/분)다 |
| `trailing_off_ratio` · `pitch_range_st` | `trailingOffRatio` · `pitchRangeSt` | 말한 시간으로 가중한 평균 |
| `gaze_ratio` | 키를 전송하지 않음 | 화면이 5.8로 보낸 값을 BE가 저장한다(API 명세 5.8) |

- 값이 있는 답변만으로 계산하고, 모든 답변에 값이 없으면 null이다
- 컬럼이 `NUMERIC(5, 2)`이므로 999.99를 넘는 값은 구하지 못한 것으로 간주해 null로 전송한다. 상한으로 잘라 전송하면 실제와 다른 지표가 되기 때문이다

## 5. 실패 처리

| 상황 | 처리 | `reason` |
|---|---|---|
| GMS 타임아웃·429·5xx | 3회 재시도. 다 실패하면 PLAN은 `plan.failed`, EXTRACT_CLAIMS는 `claims.extractFailed`, EVALUATE는 `evaluation.failed`. SCORE_ANSWER는 결과를 전송하지 않고 EVALUATE에 맡긴다 | `GMS_UNAVAILABLE` |
| 출력 구조 깨짐(JSON 아님, 개수·판정 값 틀림) | 1회 재시도 후 위와 같이 처리 | `INVALID_OUTPUT` |
| BE 최대 대기 시간 초과 | PLAN·EXTRACT_CLAIMS 3분·EVALUATE 10분(BE 설계 5.1·5.4 `ai-job.plan-timeout`·`ai-job.analysis-timeout`)을 BE가 작업을 요청한 시각(`requestedAt`, 1.3)부터 계산한다. 큐에서 기다린 시간까지 포함해 BE와 같은 시각에 마감하기 위함이다. GMS를 호출하기 전마다 확인해 넘었으면 호출을 중단하고 실패 결과를 전송한다. 이미 BE가 `FAILED`로 처리한 작업에 GMS 비용과 처리 시간을 사용하지 않기 위함이다 | `TIMED_OUT` |
| 작업 메시지 형식 오류 | 1.3 | `INVALID_JOB` |
| 그 밖의 예상하지 못한 오류 | 실패 결과를 전송하고 작업을 마친다. 원인은 작업자 로그에 남긴다. 작업을 처리 중 리스트에 남기면 작업자를 다시 시작할 때마다 같은 오류가 반복되기 때문이다. SCORE_ANSWER는 결과를 전송하지 않는다 | `INTERNAL_ERROR` |
| 결과 큐에 넣기 실패 | 1·2·4초 간격으로 3회 재시도한다. 그래도 실패하면 작업을 처리 중 리스트에 남겨 작업자를 다시 시작할 때 다시 처리한다. 같은 결과가 두 번 전송돼도 BE가 제외한다(1.4) | — |
| 작업자 중단·메시지 유실 | 최대 대기 시간이 지나면 BE가 5.2 조회 때 `FAILED`로 변경한다(값은 API 명세 B-11) | — |

녹화 합치기의 실패 이유는 7장.

`FAILED`가 되면 화면은 5.3(플랜)·5.9(결과)로 다시 시도한다. 면접 에이전트의 실패 처리는 6.5.

## 6. 면접 에이전트

면접방(LiveKit)에 참가자로 들어가 면접을 진행한다. 질문을 발화하고, 지원자 음성을 인식하고, 리액션을 결정하고, 답변이 끝났는지 판단해 BE에 전달한다. LiveKit Agents(Python)로 구현하고 STT는 원본 토큰별 시각을 보존하도록 Soniox WebSocket에 직접 연결한다. TTS는 ElevenLabs REST `POST /v1/text-to-speech/{voice_id}/with-timestamps`로 질문 글 하나를 통째로 합성해 음성(PCM 24kHz)과 원문 글자별 발음 시각을 함께 수신한다. `question`(`started`)에 질문 전체의 글자별 시각을 담아야 하는데, LiveKit ElevenLabs 플러그인은 시각을 단어 단위로 묶고 스트리밍 중 조각마다 늦게 전달하기 때문이다. 미리 생성한 질문 5개는 배정 때 알고 있으므로 미리 합성해 지연을 줄이고, 꼬리질문(2.2)은 생성한 직후 합성한다. 면접관별 음성 id는 DEVIL `FXxhHa2cRkhRQpD1I1Ut`, COFFEE_CHAT `kv35JHV8eknIPqadZFol`, DUCK `HERgDqDuzwb5wIvxFuTw`, 모델은 `eleven_multilingual_v2`다. 질문, 말 끊기 안내, 오리 면접관의 칭찬(6.2)은 면접관 음성 트랙 하나로 송출한다. 오리 면접관의 호응 효과음은 화면이 재생하므로 송출하지 않는다(API 명세 면접방 메시지). 화면 동작은 [API 명세 면접방 메시지](API-명세.md#면접방-메시지-livekit)를 따른다.

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
    { "seq": 1, "content": "응답 시간을 40% 줄인 과정은?", "criteria": "원인 분석 · 수치 근거", "companyItem": null }
  ] }
```

- `questions`는 미리 만든 5개 전부. 에이전트는 DB를 읽지 않으므로 질문 글과 채점 기준을 여기서 받는다. 2·4·5번은 꼬리질문의 예비 질문으로 사용한다(2.2)
- `companyItem`은 플랜의 질문별 연결 회사 항목(2장)을 그대로 담는다. 꼬리질문 생성(2.2)의 입력으로 사용한다. 필드가 없으면 null로 처리한다. 필드를 추가하기 전에 BE가 전송한 배정과 배포 순서 차이를 처리하기 위함이다
- 형식이 틀리면(질문 5개가 아님, 질문 글·채점 기준이 비어 있음, 512KiB 초과 등) 에이전트는 배정을 거절한다(6.5)
- `currentSeq`: 몇 번 질문부터 할지. 처음엔 1이고, 에이전트가 중간에 끊겨 다시 배정할 때 이어 갈 번호다
- 면접이 끝나면 BE가 방을 삭제(`RoomService.DeleteRoom`)하고 에이전트는 그 면접을 정리한다. 끝나지 않은 답변은 보내지 않는다

### 6.2 진행 흐름

질문마다 다음을 반복한다(1~5번). 2·4·5번 질문은 직전 기본 질문의 답변이 끝나면 생성한 꼬리질문이고, 생성하지 못하면 예비 질문이다(2.2).

1. **질문** 면접방 메시지 `question`(`started`)을 전송한 뒤 질문 음성을 송출한다. 음성의 첫 소리를 송출하는 시각을 `startedAt`으로 해 `question.started` 결과 메시지(`seq`, `startedAt`, 출제한 질문의 `content`·`criteria`, `promptVersion`·`modelVersion`)를 전송한다. 합성에 실패해 음성 없이 출제하면 `question`(`failed`)을 전송하기 직전 시각을 `startedAt`으로 한다. 다 말하면 `question`(`ended`)을 전송한다
2. **듣기(화상)** 지원자 음성을 STT로 수신해 확정 토큰과 시각을 수집한다. 에이전트는 `interview.stt` 텍스트 스트림으로 확정 글·미확정 글의 전체 스냅샷을 지원자 화면에 전달한다. 미확정 글은 교체하며 토큰별 시각은 에이전트에 보존한다. 같은 음성으로 말끝 흐림·억양 폭(3장)을 계산한다
3. **리액션** 화상은 문장이 끝날 때마다(문장 끝 기준은 API 명세 면접방 메시지), 채팅은 `chat.input`을 받을 때마다 입력 글의 마지막 문장을 Jev로 판단해 `reaction`을 보낸다(6.4)
4. **답변 끝(화상)** 마지막 말소리 뒤 7초 침묵(임시 값) 또는 `answer.submit`이면 답변을 끝낸다. 처음 말소리가 들린 뒤 3분(임시 값)이 지나면 말이 이어져도 7초 침묵과 같이 자동으로 끝낸다(`endReason` `AUTO_SUBMIT`). 주변 소리가 계속 인식돼 답변이 끝나지 않는 것을 막는다. 말 끊기 안내 음성(6.3)을 재생하는 동안에는 7초 계산을 멈추고, 재생이 끝난 시점부터 7초를 다시 계산한다. 안내 음성의 합성을 기다리는 동안에는 계산을 멈추지 않는다. 한마디도 안 했으면 끝내지 않고, 60초(임시 값) 동안 말을 시작하지 않으면 `answer.state`(`timedOut`)를 보낸다. 전송한 뒤에도 같은 질문에서 계속 듣고, 말을 시작하면 7초 규칙으로 끝낸다. 다음 질문으로 진행하지 않으며, 면접을 중단하려면 면접 끝내기(API 명세 5.8)를 사용한다. STT를 다시 연결하는 동안에는 7초 계산을 멈추고 다시 연결된 시점부터 다시 계산하며, 다시 연결하지 못하면 다음 질문으로 진행한다(6.5)
5. **답변 전달(화상)** `answer.completed` 결과 메시지를 보내고 `answer.state`(`submitted`)를 보낸다

```json
{ "type": "answer.completed", "sessionId": 55, "seq": 3,
  "answerStartedAt": "2026-10-22T14:02:18.250+09:00",
  "content": "조회 쿼리 실행 계획을 보고…",
  "tokens": [ { "text": "조회", "startMs": 0, "endMs": 280 } ],
  "speech": { "trailingOffRatio": 12.5, "pitchRangeSt": 6.2, "trailingOffAtMs": [ 9120 ],
              "impressions": { "promptVersion": "impression-v1", "modelVersion": "jev-1.14.0",
                               "items": [ { "atMs": 1500, "face": 0.98, "stability": 62.5, "confidence": 70.1,
                                            "expression": 55.0, "emotion": 48.3, "likeability": 66.0, "trust": 71.2 } ] } },
  "sttGaps": [ { "startMs": 21400, "endMs": 23950 } ],
  "endReason": "AUTO_SUBMIT", "occurredAt": "2026-10-22T14:03:12.418+09:00" }
```

- `answerStartedAt`: 에이전트가 그 답변을 듣기 시작한 시각(밀리초까지). `tokens` 시각의 0ms이고, 다시보기에서 영상 0초(API 명세 6.4 `recordingStartedAt`)와의 차이로 답변 위치를 구한다
- `content`: 답변 글. 1~10,000자(BE와 같은 UTF-16 단위). 넘는 답변은 잘라 전송하지 않는다. 채점 대상 글이 변경되기 때문이다
- `tokens`: STT가 확정한 토큰을 그대로(단어 일부·공백 포함, 단어로 합치지 않음). 끝 표시 토큰(`<end>`·`<fin>`)은 제외한다. 10,000개 이하, `0 ≤ startMs ≤ endMs`. STT가 재연결돼도 시각은 `answerStartedAt` 기준으로 이어서 계산한다. 토큰이 없으면 null
- `speech`: 말끝 흐림 비율 `trailingOffRatio`·억양 폭 `pitchRangeSt`(계산은 3장 표). 구하지 못한 값은 null. 다시보기 타임라인용으로 말끝 흐린 문장의 끝 시각 `trailingOffAtMs`(3장, 10,000개 이하, 0 이상, 시각 순)와 인상 판단 `impressions`(6.6)를 함께 담는다 **[제안]**. 둘 다 구하지 못했으면 null
- `question.started`의 `startedAt`도 밀리초까지 기록한다(다시보기 마커 기준). `content`·`criteria`는 실제로 출제한 질문의 글·채점 기준이고, BE는 플랜이 아니라 이 값으로 질문 행을 저장한다. `promptVersion`·`modelVersion`은 꼬리질문이면 생성 버전, 예비 질문이나 기본 질문이면 null이다(2.2)
- `sttGaps`: STT가 끊겨 음성을 인식하지 못한 구간 목록. 구간마다 `startMs`·`endMs`(`answerStartedAt` 기준 밀리초, `0 ≤ startMs ≤ endMs`, 시각 순)를 담는다. `startMs`는 끊긴 연결에서 마지막으로 응답을 수신한 시각, `endMs`는 새 연결로 음성 전송을 다시 시작한 시각이며 다시 연결하지 못했으면 답변을 끝낸 시각이다(6.5). 채점·결과 생성에서 끊긴 구간을 지원자의 멈춤·반복과 구분하는 데 사용한다(3·4장). 끊긴 적이 없으면 null
- `endReason`: `AUTO_SUBMIT`(침묵 7초) · `MANUAL_SUBMIT`([답변 완료]) · `STT_FAILED`(STT를 다시 연결하지 못해 그때까지 인식된 글로 제출, 6.5)
- **채팅** 답변은 화면이 5.7로 BE에 낸다. 화면은 5.7 응답이 202이거나 409 `ANSWER_ALREADY_SUBMITTED`이면 `answer.submit`(`seq`, 5.7로 제출한 답변 글 `content`)을 전송한다. 에이전트는 이 `content`로 꼬리질문을 생성한다(2.2). 409를 포함하는 것은 새로고침 뒤 다시 제출해 이미 저장된 답변도 다음 질문으로 진행하게 하기 위함이다. 에이전트는 `seq`가 지금 질문일 때만 다음 질문으로 진행하고, 이미 진행한 질문의 `answer.submit`은 무시하고 `false`로 응답한다
- **호응(오리 면접관)** 호응 효과음은 화면이 재생한다(API 명세 면접방 메시지). 오리 면접에서는 답변 전달 뒤 효과음 길이(1초)만큼 기다린 뒤 칭찬 한 문장을 면접관 음성으로 발화하고 다음 질문으로 진행한다. 효과음은 제출이 시작될 때 재생되므로 제출 처리 뒤 1초를 기다리면 처리 시간과 관계없이 효과음과 칭찬이 겹치지 않는다. 마지막 답변 뒤에는 화면이 면접 끝내기(API 명세 5.8)를 호출하므로 기다리지 않고 칭찬도 하지 않는다
  - 칭찬은 그 답변 중에 수신한 마지막 리액션 판단(6.4)으로 선택하고, 제출 시점에 Jev를 다시 호출하지 않는다. 판단 대기로 다음 질문이 지연되지 않게 하기 위함이다
  - 아래 표를 위에서부터 확인해 처음 해당하는 칭찬을 사용한다. 판단이 부정적이어도 태도·노력을 칭찬하는 것은 오리 면접관의 목적이 자신감 향상이기 때문이다(API 명세 면접방 메시지의 오리 리액션 표시와 같은 이유). 기준값 0.5·0.75는 임시 값이다
  - 칭찬 음성은 오리 면접관 음성(위 음성 id·모델)으로 미리 합성한 파일을 사용한다. 문장이 정해져 있어 면접마다 합성할 필요가 없기 때문이다

  | 마지막 판단 | 칭찬 |
  |---|---|
  | 판단 없음(Jev 호출 실패·시간 초과, 판단 전에 답변 종료) | 잘하고 있어요. |
  | 리액션(`expression`·`gesture`)이 `frown`·`smirk`·`tilt`이거나 관심·신뢰가 모두 0.5 미만 | 끝까지 차분하게 말씀해 주셨어요. |
  | 신뢰 0.75 이상 | 근거까지 잘 설명해 주셨어요. |
  | 관심 0.75 이상 | 경험을 구체적으로 들려주셨네요. |
  | 리액션이 `smile` | 좋은 내용이었어요. |
  | 리액션이 `nod` | 핵심을 잘 짚어 주셨어요. |
  | 그 밖 | 잘 들었어요, 고마워요. |

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

인상 판단(6.6)용 카메라 사진은 LiveKit 바이트 스트림 `interview.frame`으로 화면이 에이전트(`interviewer`)에게만 보낸다 **[제안]**. RPC 본문 상한(15KiB)보다 사진이 커서 바이트 스트림을 쓴다.

- 화상 면접 동안 1초마다 1장이다. 본문은 JPEG(640×480, 품질 0.8)이고, 속성 `ageMs`는 사진을 찍은 뒤 보낼 때까지 걸린 시간(밀리초, 0 이상 정수 문자열)이다
- 사진은 화면이 시선 추적(API 명세 5.8)과 같은 MediaPipe 측정으로 고른다. 0.1초마다 두 눈 `eyeBlinkLeft`·`eyeBlinkRight` 평균을 재고, 그 1초 동안 가장 작은(눈을 가장 크게 뜬) 프레임을 보낸다. 얼굴이 잡히지 않은 1초는 보내지 않는다
- 화면은 응답을 기다리지 않는다. 에이전트가 판단하지 않는 구간(질문 음성 재생 중 등)에도 보내며, 에이전트가 버린다

이하 RPC의 본문은 JSON 문자열(15KiB 이하)이다. 질문은 `seq`(질문 순서 1~5)로 가리키고, 리액션·채팅 입력은 `seq`를 메시지 순번으로 사용하므로 질문을 `questionSeq`로 가리킨다. 메시지 종류와 화면 동작은 API 명세 면접방 메시지를 따른다.

RPC 메시지에 공통 필드 `type`(메시지 종류, API 명세 면접방 메시지 표의 메시지 이름)과 `sessionId`(면접 id)를 담는다. 아래 표의 필드는 공통 필드를 제외한 것이다. `interview.stt` 스냅샷에는 이 공통 필드를 사용하지 않는다.

| RPC 메서드 | 방향 | 필드 |
|---|---|---|
| `interview.question` | 에이전트 → 화면 | `seq`, `content`, `speech`(`started`·`ended`·`failed`), `alignment`(`started`에만 `{ chars[] }`, `chars[]` = `{ char, startMs, endMs }`, 질문 음성 맨 앞이 0. 그 밖에는 null. 키는 항상 담는다) |
| `interview.reaction` | 에이전트 → 화면 | `questionSeq`(질문 순서), `seq`(그 답변 안에서 1부터 증가, 화면은 가장 큰 값만 씀), `reaction`(`type`·`expression`·`gesture`·`intensity`·`durationMs`, 판단하지 못했거나 반응할 내용이 없으면 null), `attitude`(`interest`·`trust`, 0~1, 첫 판단 전에는 0.5), `interrupt`(`reason`: `OFF_TOPIC`·`TOO_LONG`, `text`, 채팅은 항상 null) |
| `interview.answerState` | 에이전트 → 화면 | `seq`(질문 순서), `state`: `autoSubmitted` · `timedOut` · `sttReconnecting` · `sttFailed` · `submitted` · `submitFailed` |
| `interview.attitude` | 에이전트 → 화면 | `score`(인상 점수, 0~100 정수. 쓸 수 있는 사진이 없으면 null). 화상 답변을 듣는 동안 인상 판단(6.6)이 올 때마다 다시 계산해 바뀌었을 때만 보낸다 **[제안]** |
| `interview.answerSubmit` | 화면 → 에이전트 | `seq`(질문 순서), `content`(채팅만, 5.7로 제출한 답변 글, 1,000자 이하. 화상은 null). 응답 `{ "accepted": true }`, 이미 제출 중이면 `false`. `submitFailed` 뒤에 수신하면 보관한 답변을 다시 전송하고 `true`로 응답한다(6.5) |
| `interview.chatInput` | 화면 → 에이전트 | `questionSeq`(질문 순서), `seq`(그 답변 안에서 1부터 증가), `text`(입력 칸 전체, 1,000자 이하), `pauseMs`. 응답 `{ "accepted": true }`. 현재 진행 중인 질문이 아니거나 그 질문에서 이미 수신한 `seq` 이하면 판단하지 않고 `false`로 응답한다. `true`는 판단 대상으로 수신했다는 뜻이며 리액션 판단의 성공을 뜻하지 않는다 |

- RPC 오류: `2001 EMPTY_ANSWER`(한마디도 안 함), `2002 NOT_ANSWERING`(질문 음성 재생 중 등). 1001~1999는 LiveKit 예약
- 발음 시각이 15KiB를 넘으면 나눠 보낼지 텍스트 스트림을 쓸지 **[미정]**. 지금은 `alignment`를 null로 보내고 질문 음성은 그대로 낸다(한글 질문 약 330자 이상에서 발생)
- 화면이 RPC를 받지 못해도(처리 함수 없음·3초 안에 응답 없음) 질문 음성은 계속 낸다
- 말 끊기(`interrupt`)의 `text`는 에이전트가 음성으로도 말한다. 말 끊기는 답변을 제출하지 않으며, 지원자는 같은 질문의 답변을 이어서 말한다. 말 끊기 전후의 발화는 하나의 답변으로 제출된다. 안내 음성을 재생하는 중에 `answer.submit`을 수신하면 `2002`로 거절하지 않고, 안내 음성을 멈춘 뒤 답변을 제출한다
- `reaction.durationMs`는 2,400ms다. 리액션이 없을 때와 `durationMs`가 지난 뒤 면접관은 기본 상태(듣는 중 `listening`, 무표정)다
- `reaction` 객체는 키를 항상 모두 담고, 해당하지 않는 값은 null이다. 표정이면 `gesture`가, 동작이면 `expression`·`intensity`가 null이다. 화면이 키가 있는지 분기하지 않고 같은 형식으로 읽게 하기 위해서다

### 6.4 리액션 판단 (Jev)

- 입력: 실제로 출제한 질문·채점 기준(꼬리질문이면 생성한 질문, 그 밖에는 배정 정보, 2.2), 전송된 글(화상은 끝난 문장, 채팅은 입력 글의 마지막 문장)과 쉰 시간, 지금까지의 답변 글, 직전 태도(`attitude`). 면접 방식은 발화 중단을 판단할지 정하는 데만 쓴다. 최근 글·태도는 에이전트가 면접 동안 메모리에 둔다
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
| 인상 판단 Jev 늦음·실패 | 그 사진은 남기지 않는다(6.6). 답변 진행과 제출에는 영향이 없다 |
| LiveKit 일시 끊김 | 브라우저 SDK가 재접속하며 화면에 연결 중 상태를 표시한다. 완전히 끊기면 [다시 연결]로 5.14 입장 정보를 새로 받는다 |
| 지원자 퇴장·새로고침 | 현재 STT 캡처를 정리하고 에이전트는 방에서 재입장을 기다린다. 재입장하면 새 캡처를 시작한다. 답변 중이었으면 그때까지 인식한 글을 폐기하고 답변 끝 판단의 7초·60초 계산을 멈추며, 재입장하면 같은 질문의 답변을 처음부터 다시 듣는다. 질문 음성 재생 중에 퇴장했으면 재입장 뒤 면접방 메시지 `question`(`started`)부터 질문을 다시 말한다. 결과 메시지 `question.started`는 이미 전송했으면 다시 전송하지 않고, 음성을 송출하기 전에 퇴장해 아직 전송하지 않았으면 다시 말하며 음성을 송출할 때 전송한다(6.2). 리액션의 태도(`attitude`)는 면접 전체에 대한 값이므로 유지하고, 폐기한 답변으로 판단 중이던 리액션은 전송하지 않는다. 같은 질문의 리액션 `seq`는 1로 되돌리지 않고 이어서 증가시킨다. 새로 연결한 화면은 이전 채팅 입력 `seq`를 알 수 없으므로, 재입장하면 수신한 채팅 입력 `seq` 기록을 초기화한다 |
| Soniox STT 오류 | 연결하지 못하거나(연결 제한 10초), 연결이 끊기거나, 음성을 전송하는 중에 5초(임시 값) 동안 응답이 없으면 다시 연결한다. 다시 연결은 최대 3회이며 간격은 첫 번째 0.1초, 이후 2초다(LiveKit Agents STT 연결 기본값과 같음). 다시 연결하는 동안 `answer.state`(`sttReconnecting`)를 전송하고, 그동안 수신한 음성은 STT로 전송하지 않는다. 모아 두었다가 이어 전송하면 지원자가 끊긴 것을 알고 처음부터 다시 말할 때 같은 내용이 두 번 인식되기 때문이다. 다시 연결되면 인식된 글을 유지한 채 이어서 듣고, 인식하지 못한 구간은 `answer.completed`의 `sttGaps`로 전달한다(6.2). 3회 모두 실패하면 `interview.stt`의 `state: failed`와 `answer.state`(`sttFailed`)를 전송하고 다음 질문으로 진행한다. 그 답변에서 발화가 있었으면 그때까지 인식된 글을 `endReason` `STT_FAILED`로 제출하고, 발화가 없었으면 `answer.completed`를 전송하지 않으며 그 답변은 저장되지 않는다. STT 오류는 지원자가 일으킨 것이 아니므로 인식된 글을 폐기하지 않는다 |
| TTS 실패 | `question`에 `failed`. 화면은 질문 글로 진행 |
| 면접관 음성 송출 실패·재생 멈춤 | 에이전트와 LiveKit 사이 송출이 막히면 재생이 끝나지 않아 면접이 진행되지 않으므로, 질문·말 끊기 안내·칭찬 음성은 송출에 실패하거나 음성 길이 + 10초(임시 값) 안에 재생이 끝나지 않으면 남은 음성을 폐기한다. 질문이면 `question`에 `failed`를 전송하고 답변 듣기로 진행하며, `question.started`는 재생을 시작할 때 이미 전송했으므로 다시 전송하지 않는다. 말 끊기 안내는 멈춘 시점부터 7초 계산을 다시 시작하고(6.2), 칭찬은 다음 질문으로 진행한다 |
| 결과 큐에 넣기 실패 | 1·2·4초 간격으로 3회 재시도(5장). 답변 완료(`answer.completed`)가 재시도 후에도 실패하면 `answer.state`로 `submitFailed`를 전송한다. 에이전트는 그 답변을 메모리에 보관하고 다음 질문으로 진행하지 않는다. 화면은 실패를 안내하고 [다시 시도]를 표시하며, 에이전트는 `submitFailed` 상태에서 `answer.submit`을 수신하면 보관한 같은 답변을 같은 재시도 규칙으로 다시 전송한다. 성공하면 `answer.state`(`submitted`)를 전송하고 다음 질문으로 진행한다. 면접을 중단하려면 면접 끝내기(API 명세 5.8)를 사용하며, 이때 보관한 답변은 저장되지 않는다. `submitFailed` 상태에서 지원자가 재입장하면 `submitFailed`를 다시 전송한다. 새로 연결한 화면은 실패 상태를 알 수 없기 때문이다. 같은 결과가 두 번 전송돼도 BE가 제외한다 |
| 질문 시작 전송 실패 | `question.started`가 재시도(5장) 후에도 실패해도 질문은 그대로 진행한다. 질문 행이 없으면 BE가 그 질문의 답변을 저장하지 못하므로, 에이전트는 같은 메시지를 보관하고 전송에 성공하거나 면접이 끝날 때까지 4초 간격으로 다시 전송한다. 화상은 `question.started` 전송에 성공한 뒤에만 `answer.completed`를 전송하고, 답변이 끝날 때까지 성공하지 못하면 결과 큐에 넣기 실패와 같이 `submitFailed`를 전송한다. 이 상태에서 `answer.submit`을 수신하면 `question.started`부터 다시 전송한다. 채팅은 질문 행이 생기기 전까지 답변 제출(API 명세 5.7)이 404 `QUESTION_NOT_FOUND`로 실패하며, 다시 제출하면 저장된다 |
| 저장할 수 없는 답변 | 답변 글·토큰이 `answer.completed`의 범위(6.2)를 벗어나면 다시 전송해도 BE가 저장하지 못하므로, `answer.completed`를 전송하지 않고 다음 질문으로 진행한다. `answer.state`(`submitted`·`submitFailed`)는 전송하지 않으며, 그 답변은 저장되지 않는다 |
| 꼬리질문 생성 실패·시간 초과 | 같은 순서의 예비 질문을 출제한다(2.2). 면접 진행에는 영향이 없다 |
| 에이전트가 면접 도중 끊김 | BE가 `currentSeq`를 넣어 다시 배정한다. 누가 끊김을 알아채고 언제 다시 배정할지 **[미정]**. 이미 출제한 꼬리질문은 질문 행에만 남으므로, 다시 배정할 때 그 질문 글을 넘길지도 함께 정한다 |
| 배정 정보 형식 오류 | LiveKit이 배정을 에이전트에 전달할 때 방에 들어가지 않고 거절한다. 틀린 배정 정보로는 질문을 진행할 수 없고, 같은 배정 정보로는 어느 에이전트 서버도 진행할 수 없으므로 다른 에이전트 서버에 다시 넘기지 않는다. 결과 메시지 `assignment.rejected`(`INVALID_ASSIGNMENT`)를 전송한다. 배정 정보에서 면접 id(`sessionId`)를 읽지 못하면 방 이름(`interview-{sessionId}`, 6.1)에서 읽고, 방 이름으로도 알 수 없으면 전송하지 않는다. BE는 면접방을 닫고 면접을 `START_FAILED`로 변경하며, 화면은 다시 시작(API 명세 5.4)을 안내한다(1.4) |
| 면접관 미입장·첫 질문 기한 초과 | 배정을 수락할 에이전트 서버가 없거나 에이전트가 10초 안에 응답하지 않으면 LiveKit은 배정을 다시 시도하지 않으므로(LiveKit 서버 v1.13.10), 면접관이 입장하지 않는다. BE는 질문 행이 없는 동안 LiveKit `ListParticipants`로 면접방을 조회하고, 배정 요청을 마친 시각부터 15초(임시 값)가 지나도 면접관(`interviewer`)이 없거나, 지원자(`candidate`)가 입장한 시각(`joinedAt`)부터 30초(임시 값)가 지나도 질문 행이 없으면 면접방을 닫고 면접을 `START_FAILED`로 변경하며, 화면은 다시 시작(API 명세 5.4)을 안내한다. 지원자가 아직 입장하지 않았으면 30초 기한을 계산하지 않으므로, 지원자가 늦게 입장해도 실패로 처리하지 않는다 |
| 지원자가 끝내기 없이 떠남 | 지원자(사람 참가자)가 모두 나가고 BE가 정한 `departure_timeout`(10분)이 지나면 LiveKit이 면접방을 닫고 에이전트 연결을 `ROOM_CLOSED`로 끊는다(LiveKit 서버 v1.13.10, 에이전트는 방을 비우지 않은 것으로 세지 않음). 에이전트는 이때만 결과 메시지 `room.closed`를 전송하고, BE는 면접을 끝내기(API 명세 5.8)와 같이 끝낸다(1.4). BE가 방을 지운 경우(`ROOM_DELETED`)와 연결만 끊긴 경우(`SIGNAL_CLOSE` 등)는 전송하지 않는다. 재시도(5장) 후에도 전송하지 못하면 면접이 `IN_PROGRESS`로 남는다 |

### 6.6 인상 판단 (Jev 이미지) **[제안]**

화상 답변을 듣는 동안 지원자 카메라 사진으로 인상 6가지를 1초마다 판단해, 그 답변의 `speech.impressions`(6.2)에 담는다. 다시보기 타임라인에서 지표가 유난히 낮은 구간을 짚는 데 쓰고, 답변 중에는 인상 점수로 화면에 보여 준다.

- **인상 점수** 판단이 올 때마다 가장 최근 사진부터 3초(임시 값) 안에 찍은 판단으로 계산해 `interview.attitude`(6.3)로 지원자에게 보낸다. 얼굴 기준(0.5) 미만인 사진은 빼고, 사진마다 받은 점수를 평균한 뒤 사진들의 평균을 다시 평균한다. 결과 타임라인과 같은 기준이다. 인상 점수 평균은 대부분 가운데에서만 움직이므로 20~80(임시 값)을 0~100으로 펴고, 범위 밖은 0·100으로 자른 뒤 정수로 반올림한다. 점수가 바뀔 때만 보내고, 보내는 중에 새 점수가 나오면 마지막 값만 보낸다. 쓸 수 있는 사진이 처음부터 없으면 보내지 않고, 점수를 보낸 뒤 없어지면 null을 보낸다. 답변이 끝나면 보내지 못한 점수는 버린다. 화면이 받지 못해도 면접은 계속 진행한다

- **판단 구간** 화상 답변을 듣는 동안(6.2 2~4번) 받은 사진만 판단한다. 질문 음성 재생 중·답변 사이·채팅 면접의 사진은 버린다. 저장 위치가 답변이기 때문이다
- **시각 `atMs`** 사진을 찍은 시각에서 `answerStartedAt`을 뺀 값(밀리초)이다. 찍은 시각은 에이전트가 받은 시각에서 `ageMs`(6.3)를 뺀다. 브라우저 시계는 서버와 어긋날 수 있어 쓰지 않는다. 0 미만이면 버린다
- **판단** Jev(`jev-1.14.0`) 이미지 입력(`assets`, 요청 헤더 `TypeSafe-Danger-Zone-Images: true`)으로 한 요청에 묻는다
  - `face`: 웹캠으로 찍은 실제 사람 얼굴이 표정·시선을 알아볼 만큼 보이는지(`noul` 확률, 0~1). 그림·캐릭터·화면 속 화면에도 인상 점수가 높게 나와 같이 묻는다
  - 인상 6가지(`score`, 5단계): 안정감 `stability`·자신감 `confidence`·의사표현 `expression`·감정 전달 `emotion`·매력도 `likeability`·신뢰도 `trust`(역검 소통역량 관찰특성). 점수는 5단계 확률 가중 평균을 0~100으로 바꾼 값(소수 첫째 자리)이다
  - 외모·성별·나이·피부색·복장·배경은 판단에 쓰지 않고 표정·시선·자세·고개 방향만 보도록 지시한다
- **측정값 그대로 저장** `face`가 낮은 사진도 점수와 함께 남긴다. 얼굴로 볼 기준(0.5, 임시 값)은 쓰는 쪽에서 적용한다. 기준이나 질문 문구가 바뀌어도 저장한 값을 다시 판정할 수 있게 하기 위함이다. 받지 못한 점수는 null이다
- **요청** 리액션 판단(6.4)과 따로 요청한다. 동시 요청은 2개(임시 값)이고, 2개가 판단 중이면 새 사진은 버린다. 응답 상한은 5초(임시 값)다. 답변이 끝날 때 응답이 오지 않은 판단은 기다리지 않고 버린다. 답변 전달을 늦추지 않기 위함이다
- **형식** `{ "promptVersion", "modelVersion", "items": [ { "atMs", "face", "stability", "confidence", "expression", "emotion", "likeability", "trust" } ] }`. `items`는 `atMs` 순이고 3,600개 이하다. 판단한 사진이 없으면 `impressions`는 null이다
- **주의** 답변 1초마다 1번 호출한다. Jev 이미지 입력은 Jev 문서상 운영용이 아니다. 얼굴 사진이 미국 서버(Jev)로 간다(저장하지 않는다)

### 6.7 그룹 면접 **[결정]**

그룹 면접(API 명세 10장)에서는 **BE가 차례 · 마감 · 이탈 · 종료를 정하고, 에이전트는 BE가 정한 차례대로 질문을 말하고 듣는다**. 에이전트가 멈춰도 BE가 진행 상태를 알고 면접을 정리하기 위해서다. 설계 배경은 [그룹 면접 설계](그룹면접-설계.md). 6.1 ~ 6.6은 아래에서 다르다고 적은 것 말고는 그대로 쓴다.

**배정 정보** `kind`가 없으면 6.1의 개인 면접 형식이다.

```json
{ "kind": "GROUP", "groupId": 12, "mode": "VIDEO", "persona": "COFFEE_CHAT",
  "commonQuestions": [ { "content": "1분 동안 자기소개해 주세요.", "criteria": "핵심 경험 · 지원 동기" },
                       { "content": "의견이 다른 동료와 문제를 해결한 경험은?", "criteria": "갈등 상황 · 본인 행동 · 결과" } ],
  "participants": [
    { "sessionId": 55, "identity": "candidate-55",
      "personalQuestions": [ { "content": "…", "criteria": "…", "companyItem": null }, { "content": "…", "criteria": "…", "companyItem": null } ] } ] }
```

- 방 이름 `group-{groupId}`, 지원자 참가자 이름 `candidate-{sessionId}`, 에이전트는 6.1과 같은 `interviewer`
- `commonQuestions` 2개(자기소개 · 인성 순서), `participants` 2~3명, `personalQuestions` 2개(그룹용 PLAN, 2장). 하나라도 어긋나면 배정을 거절하고 `assignment.rejected`에 `groupId`를 담는다
- 진행 순서 · 시간은 배정 정보가 아니라 **면접방 정보**(API 명세 10.11)로 받는다. 시간 값을 바꿀 때 AI 배포가 필요 없다
- 다시 배정(끊긴 뒤 이어 하기)은 하지 않는다. 에이전트가 방을 나가면 BE가 AI 장애로 보고 면접을 끝낸다

**진행: 면접방 정보를 따른다** BE는 면접방을 만들 때 방 정보를 함께 넣고, 바뀔 때마다 고친다. 에이전트는 접속할 때 읽은 방 정보와 `RoomMetadataChanged`로 받은 정보 중 `turnVersion`이 가장 큰 것만 쓴다. 남은 질문이 없으면(모두 `DONE` · `ENDED`) `phase` · `turn`이 null이고 아무것도 하지 않는다(API 명세 10.11).

| `phase` | 에이전트가 하는 일 |
|---|---|
| `ASKING` | `turn`의 질문을 말한다. `baseIndex` 1 · 3은 `commonQuestions[0]` · `[1]`, 2 · 4는 그 사람의 `personalQuestions[0]` · `[1]`, `FOLLOWUP`은 그 사람에게 만든 꼬리질문이다. `announce`가 `CALL`이면 질문 대신 미리 합성한 호명 문구(**[미정]**)를 말한다. 이때도 `question.started` · `interview.question`의 글 · 채점 기준은 그 공통 질문이고(질문 행 · 화면 표시에 쓴다), `interview.question`의 `alignment`는 실제로 말하는 호명 음성의 발음 시각이다(면접관 입 모양에 쓴다). 음성 첫 소리를 보낼 때 `question.started`, 마지막 소리를 보내거나 합성 · 송출에 실패하면 `question.spoken`을 보낸다. 같은 `(sessionId, seq)`로 다시 오면(답변 중 나갔다 돌아온 사람, [그룹 면접 설계](그룹면접-설계.md) 6.9) 같은 질문을 다시 말하고 `question.started`부터 다시 보낸다. 꼬리질문은 다시 묻지 않는다(답변 중 나가면 BE가 닫는다) |
| `SPEAKING` | 질문 음성을 계속 보낸다(BE가 `question.started`를 받은 뒤의 단계) |
| `ANSWERING` | `turn.sessionId`의 마이크 트랙**만** 구독해 STT에 넘긴다(이전 답변자 구독은 끊는다). 리액션 · 인상 판단은 6.3 · 6.4 · 6.6과 같다. 화상은 7초 침묵 · `answer.submit` · `deadlineAt` 도달 중 먼저 오는 것으로 답변을 끝내 `answer.completed`를 보낸다. `deadlineAt`까지 한마디도 안 했으면 보내지 않는다(BE가 닫는다). 채팅은 답변을 받지 않는다(BE가 5.7 · 마감으로 확정) |
| `DECIDING` | BE가 최종 답변을 저장했다는 뜻이다. 그 답변으로 꼬리질문이 필요한지 **한 번만** 판단해 `followup.decided`를 보낸다(아래) |
| `WAITING` | 아무것도 하지 않는다 |

- `participants[].state`가 `ENDED`가 된 사람은 구독 · 보관한 꼬리질문을 정리한다. `groupStatus`가 `ENDED`면 면접을 정리한다(BE가 곧 방을 지운다)
- 답변 중 지원자가 방을 나가면 6.5처럼 그 답변을 버린다. 다음 차례는 BE가 정한다
- 6.2의 60초 무응답 안내(`timedOut`)는 보내지 않는다. 답변 시간(화상 2분 · 채팅 5분)이 대신한다
- BE가 기다리는 시간(BE 설정, 임시 값): `ASKING`을 정하고 20초 안에 `question.started`가 오지 않으면 방 정보를 한 번 더 보내고 10초 더 기다린다. 그래도 오지 않으면 AI 정체로 보고, 그룹이 질문을 하나도 내지 않았으면 시작 실패, 냈으면 AI 장애로 면접을 끝낸다. 화상은 `deadlineAt` 뒤 5초까지 `answer.completed`(`TIME_LIMIT`)를 받고, 그 뒤에는 답 없이 질문을 닫는다

**꼬리질문** 2.2와 다르다.

- 한 사람당 0~2개이고 필수가 아니다. 미리 만든 예비 질문이 없다. 남은 수는 방 정보 `turn.followupsLeft`로 받는다(0이면 BE가 `DECIDING`을 건너뛴다)
- 판단 재료는 최종 답변이다: 화상은 자기가 보낸 `answer.completed`의 글, 채팅은 BE가 `SendData`로 보낸 `group.answer`(아래)의 글. 채팅 작성 중인 글(`chat.input`)로는 판단하지 않는다
- 꼬리질문에 답한 뒤에도 남은 수가 있으면 다시 `DECIDING`이 온다. 이때 직전 질문은 그 꼬리질문이다
- 같은 `(sessionId, seq)`는 한 번만 판단한다. 같은 답변 글을 다시 받으면 처음 결과를 다시 보낸다
- 필요하면 질문 글 · 채점 기준을 만들고(입력 · 생성 지침 · 검증은 2.2. 직전 질문이 개인 맞춤 질문이면 그 질문의 `companyItem`을 입력에 포함한다), 아니면 `needed: false`. 판단 방법(필요 여부를 어떻게 정할지)은 정하지 않았다
- BE는 `DECIDING`을 시작하고 7초(설정 값) 안에 온 판단만 쓴다. 늦으면 꼬리질문 없이 넘어가므로 에이전트는 기다리지 말고 바로 보낸다. 구현 뒤 응답 시간을 보고 2~3초로 줄일 수 있다
- 만든 꼬리질문은 BE가 그 사람의 `FOLLOWUP` 차례를 정할 때까지 들고 있다. 다른 차례가 오면 버린다

**면접방 메시지** 6.3과 다른 점

| 메시지 | 그룹 면접에서 |
|---|---|
| `interview.question` · `interview.reaction` | 방의 모두에게 보내고 `sessionId`(지금 답변자)를 더한다 |
| `interview.stt` · `interview.answerState` · `interview.attitude` | 지금 답변자에게만 |
| `interview.frame` | 참가자마다 에이전트에게 보내고, 에이전트는 지금 답변자 것만 판단한다 |
| `interview.answerSubmit` | 화상만. 보낸 사람이 지금 답변자가 아니거나 `seq`가 지금 질문이 아니면 `false` |
| `interview.chatInput` | 리액션용으로 그대로 쓴다. 보낸 사람의 참가자 이름(`candidate-{sessionId}`)의 면접 id가 메시지의 `sessionId`와 같고, 그 면접 · `questionSeq`가 지금 차례(`turn.sessionId` · `turn.seq`)일 때만 받는다. 아니면 `false`. 화면은 지금도 자기 면접 id와 질문 순서를 담아 보내므로 바꾸지 않는다 |
| `group.answer` (새) | BE → 에이전트, LiveKit `SendData`(주제 `group.answer`, 대상 `interviewer`). 채팅 최종 답변이 저장되면 `sessionId` · `seq` · `content` · `turnVersion`. BE가 전달에 실패하면 7초 안에서 다시 보낸다 |

**결과 메시지** `ai:results:group`으로 보낸다(1.4). 모든 메시지에 받은 방 정보의 `turnVersion`을 담는다. BE는 지금 차례(같은 `sessionId` · `seq`)를 정한 뒤의 버전이 아니거나 단계가 맞지 않으면 늦은 메시지로 보고 버린다(차례 안에서도 단계마다 버전이 오르므로 마지막으로 받은 버전을 그대로 담으면 된다). 전송 실패 재시도는 6.5와 같다.

| `type` | 6.2 · 1.4와 다른 점 |
|---|---|
| `question.started` | `turnVersion` · `kind` · `speechMs`(질문 음성 길이, 밀리초. 음성 없이 출제하면 0) 추가. `seq`는 1~6 |
| `question.spoken` (새) | `sessionId` · `seq` · `turnVersion` · `endedAt`(음성 마지막 소리 · 실패 시각, 밀리초) · `speech`(`ENDED` · `FAILED`). BE는 이 시각부터 답변 시간을 센다. 오지 않으면 `speechMs` + 5초 뒤에 BE가 스스로 시작한다 |
| `answer.completed` | `turnVersion` · `answerEndedAt`(답변을 끝낸 시각) 추가. `endReason`에 `TIME_LIMIT`(마감) 추가 |
| `followup.decided` (새) | 아래 |
| `assignment.rejected` | `ai:results:group`으로 보내고 `groupId` · `reason` · `occurredAt`을 담는다(`sessionId` 없음). BE는 그룹이 질문을 하나도 내지 않았고 `occurredAt`이 마지막 시작 뒤일 때만 시작 실패로 바꾼다 |

```json
{ "type": "followup.decided", "sessionId": 55, "seq": 2, "turnVersion": 18,
  "needed": true, "content": "그때 팀원 의견을 어떻게 모았나요?", "criteria": "의견 수렴 방법 · 결과",
  "promptVersion": "followup-v2", "modelVersion": "…",
  "receivedAt": "2026-11-04T14:05:03.210+09:00", "generationMs": 1830, "occurredAt": "2026-11-04T14:05:05.100+09:00" }
```

- `needed: false`면 `content` · `criteria` · 버전은 null
- `receivedAt`(판단을 시작한 시각) · `generationMs`(GMS 호출 시간)는 응답 시간을 재기 위한 값이다. BE는 `DECIDING` 시작부터 도착까지를 따로 재고, 7초 뒤에 온 판단도 버리기 전에 시간을 기록한다

**성능 시험** 질문 생성 · 음성 처리 · 동시 접속 성능 시험은 AI 담당이 한다. 에이전트 한 대가 동시에 맡을 그룹 수(그룹 하나를 면접 몇 개로 셀지)를 함께 정한다 **[미정]**

## 7. MERGE_RECORDING: 녹화 합치기

화상 면접이 끝나면 Egress가 저장한 트랙(지원자 영상·음성, 면접관 음성)을 mp4 하나로 합친다(운영 배포 계획 4.3).

- **시작** 5.8(화상). 면접 중이 아니라 끝난 뒤 큐 작업으로 하므로 면접 중 CPU를 쓰지 않는다
- **입력(작업 메시지)**
  - `rawPrefix`: 원본 트랙 위치. S3 `recordings/raw/{sessionId}/`로 시작하고, BE가 녹화를 시작할 때 정한다. 시작 실패 뒤 다시 시작(API 명세 5.4)하면 시도마다 위치가 다르며, BE는 마지막 시도의 위치를 전달한다. 개인 면접은 `recordings/raw/{sessionId}/{startedAtMs}/`(시작 시도마다, BE 구현됨), 그룹 면접은 `recordings/raw/group-{groupId}/{startedAtMs}/`(그룹 시작 시도마다, BE 구현됨) **[결정]**
  - 그룹 면접만 **[결정]**: `roomName`(`group-{groupId}`, 녹화 목록 조회용), `candidateIdentity`(`candidate-{sessionId}`), `segments[]`(`start` · `end`, ISO 8601 밀리초, 시간 순). 구간은 본인 차례마다 하나이고, 질문을 낸 시각(`question.started`)부터 답변을 끝낸 시각까지다. 답이 없으면 질문을 닫은 시각, 답변 중 나갔으면 나간 시각, 그 질문 중에 면접이 끝났으면 면접을 끝낸 시각까지다. 길이가 0인 구간은 없고 구간끼리 겹치지 않는다. 이 필드가 없으면 지금 개인 면접 규칙 그대로다
  - `objectKey`: 결과 위치 `recordings/{sessionId}.mp4`
  - 다른 면접의 녹화를 읽거나 덮어쓰지 않도록, 두 값이 그 작업 `sessionId`의 위치가 아니면 형식 오류(1.3)로 처리한다. 그룹 면접은 `rawPrefix`가 `roomName`의 그룹 위치(`recordings/raw/group-{groupId}/`로 시작)이고 `candidateIdentity`가 그 `sessionId`일 때만 받는다
- **원본 트랙 파일** **[결정]** BE가 방을 만들 때 켠 트랙 자동 녹화가 `rawPrefix` 아래 `{참가자 이름}-{트랙 종류}-{트랙 id}.{확장자}`로 저장한다. 트랙 id(`TR_…`)는 LiveKit 서버가 붙이므로 미리 알 수 없다
  - 이름 앞부분으로 찾는다: `candidate-video-`(지원자 영상, H.264 → `.mp4`), `candidate-audio-`(지원자 음성, `.ogg`), `interviewer-audio-`(면접관 음성, `.ogg`)
  - 그룹 면접 **[결정]**: 지원자 트랙은 `{candidateIdentity}-video-` · `{candidateIdentity}-audio-`로 찾고 다른 참가자 파일은 쓰지 않는다. 면접관 음성은 그룹에 하나라 같이 쓴다. 녹화 목록은 `roomName`으로 조회한다. 그룹이 끝난 뒤(방이 닫힌 뒤) 작업이 오므로 면접관 음성 녹화도 끝나 있다
  - 재접속으로 트랙을 다시 올리면 같은 종류 파일이 하나 더 생긴다(덮어쓰지 않음)
  - 녹화 시작 시각은 LiveKit 녹화 목록 조회(`ListEgress`, 면접방 `interview-{sessionId}`, 끝난 녹화 포함)로 얻는다. 웹훅은 전송을 보장하지 않으므로 사용하지 않는다. 그 면접의 트랙 녹화가 모두 끝날 때까지 5초 간격으로 최대 5분(임시 값) 조회하고, 조회가 연속 3회 실패하면 조회를 중단한다
  - 녹화가 정상 완료(`EGRESS_COMPLETE`)되고 시작 시각이 있으며 길이가 0보다 큰 파일만 사용한다. Egress는 첫 패킷을 수신하지 못한 파일의 시작 시각을 종료 시각으로 채우므로 시작 시각만으로는 빈 트랙을 구분할 수 없다
  - 세 종류 트랙 중 가장 이른 파일 시작 시각(첫 패킷 수신, T0)을 영상 0초로 두고 모든 트랙을 각자 시작 시각 − T0 위치에 배치한다. 처음 시차와 재접속 공백이 함께 맞는다. 같은 종류의 빈 구간은 음성은 무음, 영상은 다시 인코딩하지 않고 직전 화면을 유지한다. 같은 종류 트랙이 겹치면 뒤 트랙이 시작하는 위치에서 앞 트랙을 자른다. 세 종류에 맞지 않는 파일은 무시한다
  - LiveKit 주소·키가 없거나, 조회를 중단했거나, 5분 안에 녹화가 모두 끝나지 않았거나, 사용할 파일 중 한 종류라도 없거나, 목록의 파일이 저장소에 없으면 저장소 목록이 15초(임시 값) 동안 바뀌지 않을 때까지 기다린 뒤 업로드 순서로 이어 붙이며, 시차는 맞추지 않는다
  - 그룹 면접은 위 경우에 이어 붙이지 않고 `recording.mergeFailed`를 전송한다. 사용할 파일 중 한 종류라도 없거나 목록의 파일이 저장소에 없으면 `TRACK_NOT_FOUND`, 녹화 시작 시각을 얻지 못하면(LiveKit 주소·키 없음, 조회 중단, 5분 안에 녹화 미완료) `MERGE_ERROR`다. 시차를 맞추지 않으면 구간을 자를 기준 시각이 없어 다른 참가자 차례가 파일에 남기 때문이다. BE는 다시보기에서 `videoStatus: FAILED`로 응답한다. 조회 실패처럼 일시적인 원인이면 다시 합치기(API 명세 6.5)로 다시 시도할 수 있다
- **처리** 영상은 다시 인코딩하지 않고 그대로 복사하고, 두 음성은 한 트랙으로 혼합해 AAC로 인코딩한 mp4를 `objectKey`에 업로드한다
  - 그룹 면접 **[결정]**: 같은 방식으로 맞춘 뒤 `segments`의 구간만 시간 순으로 잘라 이어 붙인다. 구간 밖(다른 참가자 차례)은 파일에 남기지 않는다. 영상은 다시 인코딩해 구간 경계에서 자르고, 각 구간은 `start`부터 `end`까지의 길이를 그대로 유지한다. BE가 다시보기 위치를 구간 길이를 차례로 더해 계산하는데(API 명세 6.4), 녹화의 키프레임은 약 100초에 하나뿐이라(개발 서버 화상 면접 2개 실측) 키프레임에서 자르면 구간 시작이 최대 약 100초 앞당겨지고 다른 참가자 차례가 들어가기 때문이다. 다시 인코딩 시간은 영상 길이에 비례한다(개발 PC 스레드 2개 실측: 343초 영상 11.7초, 40초 구간 3개 4.6초). 그룹 면접 작업 하나의 합치기 상한은 600초(임시 값)다. 60분 녹화에서 150초 구간 6개(합 15분)를 구간마다 앞 키프레임부터 읽어 다시 인코딩하면 개발 PC에서 39.5초(60분 전체를 읽으면 61.1초)이고, 운영 서버의 개인 면접 합치기가 같은 길이 기준 개발 PC보다 약 9배 오래 걸려(90초 안팎 면접 4건 7.7~8.8초, 개발 PC 0.88초) 이 배율이면 약 360초 걸리기 때문이다. `recordingStartedAt`은 첫 구간의 시작 시각이다
  - 같은 작업을 다시 받아도(API 명세 6.5 다시 합치기) 처음부터 다시 만들고 같은 `objectKey`에 덮어쓴다
  - 화상 면접 화면은 카메라 영상을 H.264로 송출한다. Egress 트랙 녹화는 영상을 다시 인코딩하지 않고 코덱에 맞는 형식으로 저장하므로(H.264는 MP4, Opus는 OGG) 합친 mp4도 브라우저에서 그대로 재생된다
  - 영상을 다시 인코딩하면 합치기가 면접 길이에 비례해 오래 걸려, 작업을 하나씩 처리하는 작업자에서 뒤에 대기한 작업이 BE 최대 대기 시간을 넘을 수 있다
- **결과** `recording.merged`(`objectKey`, `recordingStartedAt`). `recordingStartedAt`은 T0(ISO 8601, 밀리초까지)이고, 이어 붙여 합쳤으면 null이다. 실패하면 `recording.mergeFailed`(`TRACK_NOT_FOUND`·`STORAGE_ERROR`·`MERGE_ERROR`·`INVALID_JOB`·`INTERNAL_ERROR`, 1.4). 같은 작업을 다시 처리해도 결과가 같을 가능성이 높으므로 재시도하지 않는다. BE는 다시보기에서 `videoStatus: FAILED`로 응답한다(API 명세 6.4)

## 8. 회사 카드

회사 정보 수집 파이프라인(`company-pipeline`)이 회사마다 만든 카드를 BE가 메인 DB에 적재하고([회사 카드 ERD](ERD-회사카드.md)), 면접을 만들 때 지원서 회사명으로 찾은 카드를 PLAN·EVALUATE 작업 메시지의 `companyCard`에 그대로 담는다

- 형식: 파이프라인 카드 JSON 그대로다. 항목은 [카드 형식](../company-pipeline/pipeline/README.md#카드-형식)을 따른다(`talent`·`direction`·`market`·`recent`, 항목마다 원문 인용과 출처)
- 분류값: 파이프라인이 카드를 만들 때 항목마다 분류값을 부여한다. 질문 생성에서 회사 항목과 자소서 주장의 연결 후보를 코드로 선별하기 위함이다
  - `talent[]` 항목은 `criterion`에 2장 인재상 기준 12개 중 하나의 이름을 담는다
  - `direction[]`·`market[]`·`recent[]` 항목은 `ncs_subcategories`에 그 상황을 담당할 직무의 NCS 세분류 이름을 0~3개 담는다. 세분류는 NCS 「20 정보통신 > 01 정보기술」 분야의 세분류 전체에서 선택한다
  - 두 목록(인재상 기준 12개, NCS 세분류)의 원본은 저장소 최상위 공용 패키지 `shared/company_taxonomy` 하나다. 파이프라인과 AI는 이 패키지를 의존성으로 사용하고 목록을 따로 관리하지 않는다. 패키지에는 이 두 목록만 담는다
  - 분류값을 추가하기 전에 만든 카드에는 `criterion`·`ncs_subcategories` 칸이 없을 수 있다
- 회사를 찾지 못했거나 카드가 없으면 `companyCard`를 넣지 않는다
- EVALUATE는 PLAN과 같은 카드를 담는다. 면접 도중 카드가 갱신되어도 결과 피드백이 질문을 생성할 때와 같은 회사 정보를 사용하기 위함이다
- SCORE_ANSWER에는 담지 않는다. 회사 연결 질문은 채점 기준에 회사 항목의 내용을 포함하므로(2장) 판정에 회사 정보가 반영되기 때문이다

## 9. 버전

등록된 Prompt·Model·Rubric 버전만 사용한다(CONTRIBUTING 7장). Model은 요청하는 모델 ID(예: `gpt-4.1-mini`)를 등록해 검사하고, 결과에는 GMS 응답에 실린 스냅샷 이름(날짜 포함, 예: `gpt-4.1-mini-2025-04-14`)을 기록한다. GMS는 스냅샷 이름으로 요청을 받지 않으므로 요청은 모델 ID로 하고, 처리한 스냅샷은 응답 이름으로 남긴다. PLAN은 `plan.completed`에 담아 `interview_plans`에, SCORE_ANSWER는 `evaluation` 안에 담아 `answers.evaluation`에 남긴다. EVALUATE는 로그에만 남긴다(DB 저장은 범위 제외).

## 10. 확인 필요

| 내용 | 영향 |
|---|---|
| 실제 Jev 호출로 본 한국어 답변 판단 정확도, 서울에서의 응답 시간, 선택지 순서를 변경해도 판단이 같은지(모델 `jev-1.14.0`) | 6.4 |
| LiveKit Egress 트랙 녹화 파일이 저장소에 완성되는 시점(파일 형식은 LiveKit 문서로 확인: H.264는 MP4, Opus는 OGG), 화면이 H.264가 아닌 코덱(VP8 등)으로 송출했을 때 Egress의 저장 결과 | 7장 원본 트랙 파일 |
| Soniox WebSocket 직접 연결로 실제 한국어 음성의 확정 토큰·시각·끝 표시(`<end>`) 수신, 시각 누락·연결 끊김 처리 검증 | 6.2 `tokens`, 문장 끝 판단, 3장 말하기 분석 |
| 그룹 면접 꼬리질문 판단 응답 시간(7초 안에 오는 비율, p90), 다른 참가자 목소리가 답변자 STT에 섞이는 정도, 에이전트 한 대의 동시 그룹 수 | 6.7 |
| 그룹 녹화 구간 잘라 붙이기의 다시 인코딩 시간 · CPU | 7장 |
