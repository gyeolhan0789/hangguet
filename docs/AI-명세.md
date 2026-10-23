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

BE ─ Redis 작업 큐 ai:jobs ─▶ AI 분석 작업자 ─▶ GMS · ffmpeg      PLAN · SCORE_ANSWER · EVALUATE · MERGE_RECORDING
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
| PLAN | 5.1·5.3 | 작업 메시지 | `plan.progress` · `plan.completed` · `plan.failed` | `interview_plans`, Redis `planStatus`·`planProgress` |
| SCORE_ANSWER | 답변 저장 직후 | 작업 메시지 | `answer.scored` | `answers.evaluation` |
| EVALUATE | 5.8(답변 ≥1)·5.9 | 작업 메시지 | `evaluation.progress` · `evaluation.completed` · `evaluation.failed` | `answers`의 `score`·`good_point`·`improve_point`·`evaluation`, `session_scores`, `speech_metrics`, `interview_sessions`의 `status`·`summary`, Redis `analysisStep` |
| MERGE_RECORDING | 5.8(화상) | 작업 메시지 | `recording.merged` · `recording.mergeFailed` | `recordings` |
| 면접 에이전트 | 5.4 배정 | 배정 정보, 면접방 음성 · 메시지 | `question.started` · `answer.completed` | `interview_questions`, `answers`(화상, `speech` 포함) |

`interview_plans`(`claims`·`questions`), `answers.tokens`, `answers.evaluation`은 DB 스키마(BE 마이그레이션 V2)에 JSONB로 있다. 형식은 이 문서 2·3장을 따른다. 에이전트가 계산한 음성 지표(`answer.completed`의 `speech`, 6.2)를 저장할 `answers.speech`(JSONB)는 스키마에 없어 BE 마이그레이션으로 추가한다. 이 값은 실시간 음성으로만 계산하므로 채점이 실패해도 결과 생성(4장)에서 사용할 수 있도록 답변과 함께 저장한다.

### 1.2 Redis 진행 상태

- 키는 Redis Hash `session:{sessionId}:runtime`이고 **BE만 쓴다** **[결정]**. AI는 진행 상태를 결과 메시지(`plan.progress`·`evaluation.progress`)로 보내고, BE가 `planStatus`·`planProgress`·`analysisStep`에 쓴다
- Redis 값이 없으면 `interview_plans` 행이 있을 때 `planStatus`를 `READY`로 본다(BE)

### 1.3 작업 메시지 (BE → AI)

- 큐는 Redis List `ai:jobs`다. BE가 `LPUSH`하고, 작업자는 `BLMOVE ai:jobs ai:jobs:processing RIGHT LEFT`로 꺼내 처리한 뒤 처리 중 리스트에서 지운다(작업자가 멈춰도 메시지가 남음)
- 공통 필드: `jobType`(`PLAN` · `SCORE_ANSWER` · `EVALUATE` · `MERGE_RECORDING`), `jobId`(UUID 문자열), `sessionId`, `requestedAt`(BE가 작업을 요청한 시각, ISO 8601). BE와 AI는 PLAN·EVALUATE의 최대 대기 시간(5장)을 모두 이 값부터 계산한다
- AI가 DB를 읽지 않으므로 **작업에 필요한 내용을 모두 메시지에 담는다** **[제안]**. 작업별 필드는 2·3·4·7장
- BE는 Outbox로 보내므로 같은 메시지가 두 번 올 수 있다. AI는 같은 작업을 두 번 처리해도 되고, 중복 결과는 BE가 거른다(1.4)
- 형식이 틀린 작업(필수 필드 누락, 형식·범위 불일치)은 다시 처리해도 결과가 같으므로 재시도하지 않는다
  - `jobType`·`jobId`·`sessionId`를 해석할 수 있으면 그 작업의 실패 결과(`plan.failed`·`evaluation.failed`·`recording.mergeFailed`)를 `reason: INVALID_JOB`으로 즉시 전송한다. 화면이 BE 최대 대기 시간까지 기다리지 않고 다시 시도로 넘어가게 하기 위해서다
  - SCORE_ANSWER는 실패 결과 종류가 없으므로 결과를 전송하지 않는다(EVALUATE가 마저 채점)
  - 세 필드 중 하나라도 해석할 수 없으면 결과 없이 폐기하고 로그를 남긴다
- 명세에 없는 필드는 무시한다. 고도화에서 필드가 추가돼도 배포 순서와 관계없이 처리하기 위해서다

```json
{ "jobType": "SCORE_ANSWER", "jobId": "8f0c…", "sessionId": 55, "requestedAt": "2026-10-22T14:03:13+09:00", "answerId": 903,
  "mode": "VIDEO", "seq": 3,
  "question": "응답 시간을 40% 줄인 과정은?", "criteria": "원인 분석 · 수치 근거",
  "content": "조회 쿼리 실행 계획을 보고…", "tokens": [ { "text": "조회", "startMs": 0, "endMs": 280 } ],
  "speech": { "trailingOffRatio": 12.5, "pitchRangeSt": 6.2 } }
```

### 1.4 결과 메시지 (AI → BE) **[제안]**

- 큐는 Redis List `ai:results`다. AI가 `LPUSH`하고, BE는 `BLMOVE ai:results ai:results:processing RIGHT LEFT`로 꺼내 저장한 뒤 처리 중 리스트에서 지운다(BE가 멈춰도 메시지가 남음)
- 공통 필드: `type`, `sessionId`, `jobId`(작업에서 나온 결과만. 받은 작업의 `jobId`를 그대로 담는다), `occurredAt`(ISO 8601)

| `type` | 보내는 쪽 | 내용 | BE가 하는 일 |
|---|---|---|---|
| `plan.progress` | 분석 작업자 | `progress`(50 등) | `planProgress` |
| `plan.completed` | 분석 작업자 | `claims`, `questions`, `promptVersion`, `modelVersion`(2장) | `interview_plans` 저장, `planStatus: READY` |
| `plan.failed` | 분석 작업자 | `reason`(아래 실패 이유) | `planStatus: FAILED` |
| `answer.scored` | 분석 작업자 | `answerId`, `evaluation`(3장) | `answers.evaluation`이 비어 있을 때만 저장 |
| `evaluation.progress` | 분석 작업자 | `analysisStep` | `analysisStep` |
| `evaluation.completed` | 분석 작업자 | 4장 | 한 트랜잭션으로 저장, `COMPLETED`, `analysisStep` 비움 |
| `evaluation.failed` | 분석 작업자 | `reason`(아래 실패 이유) | `FAILED` |
| `recording.merged` | 분석 작업자 | `objectKey`(합친 mp4) | `recordings` 저장 |
| `recording.mergeFailed` | 분석 작업자 | `reason`(아래 실패 이유) | 다시보기 처리 **[미정]**(API 명세 B-19) |
| `question.started` | 면접 에이전트 | `seq`, `startedAt`(6.2) | `interview_questions` 생성(`created_at` = `startedAt`) |
| `answer.completed` | 면접 에이전트 | `seq`, `answerStartedAt`, `content`, `tokens`, `speech`, `endReason`(6.2) | `answers` 저장(`speech`는 `answers.speech`), SCORE_ANSWER 작업 등록 |

**실패 이유(`reason`)** 실패 결과 메시지는 아래 값 중 하나를 담는다. BE가 값으로 처리를 나눌 수 있도록 자유 문장을 사용하지 않는다.

| 값 | 결과 메시지 | 뜻 |
|---|---|---|
| `GMS_UNAVAILABLE` | `plan.failed` · `evaluation.failed` | GMS 호출이 재시도 후에도 실패했거나 재시도 대상이 아닌 오류 응답을 수신함(5장) |
| `INVALID_OUTPUT` | `plan.failed` · `evaluation.failed` | GMS 출력이 재시도 후에도 검증을 통과하지 못함(2·5장) |
| `TIMED_OUT` | `plan.failed` · `evaluation.failed` | BE 최대 대기 시간을 넘음(5장) |
| `TRACK_NOT_FOUND` | `recording.mergeFailed` | 원본 위치에 트랙 파일이 없음(7장) |
| `STORAGE_ERROR` | `recording.mergeFailed` | 녹화 저장소에서 다운로드하거나 업로드하지 못함 |
| `MERGE_ERROR` | `recording.mergeFailed` | ffmpeg가 트랙을 합치지 못함 |
| `INVALID_JOB` | 세 메시지 모두 | 작업 메시지 형식이 틀림(1.3) |
| `INTERNAL_ERROR` | 세 메시지 모두 | 그 밖의 예상하지 못한 오류. 원인은 작업자 로그에 남김 |

**중복 · 늦은 결과는 BE가 거른다**

| 경우 | 예 | 처리 |
|---|---|---|
| 중복 수신 | 같은 `answer.completed`가 두 번 | 「질문 하나에 답변 하나」(`answers.question_id` UNIQUE)로 두 번째는 버림 |
| 중복 수신 | 같은 `answer.scored`가 두 번 | `evaluation`이 이미 있어 버림 |
| 순서 역전 | 5.3 재생성 뒤 실패했던 이전 PLAN의 결과가 늦게 도착 | `planStatus`가 `GENERATING`이 아니거나 `interview_plans` 행이 이미 있으면 버림 |
| 순서 역전 | 5.9 재생성 뒤 이전 EVALUATE 결과가 늦게 도착 | `status`가 `ANALYZING`이 아니면 버림. 같은 `ANALYZING` 안에서 이전 시도와 구분하려면 BE가 마지막으로 보낸 `jobId`와 비교한다 **[제안]** |

## 2. PLAN: 질문·채점 기준 만들기

면접 전에 자소서에서 주장을 뽑고, 그 주장을 파고드는 질문 5개와 질문마다 채점 기준 1개를 만든다.

- **시작** 5.1·5.3
- **입력(작업 메시지)** `companyName`, `jobTitle`, `coverLetter` **[제안]**. 고도화에서는 회사 공시 요약(8장)을 더한다
- **STEP 01 주장 추출(GMS)** 자소서에서 경험·수치를 뽑는다. `sentenceNo`는 자소서 원문의 문장 순번(1부터)이다
  - 문장은 비어 있지 않은 줄마다 나누고, 줄 안에서는 한글·영문·닫는 괄호·%·따옴표 바로 뒤의 마침표·물음표·느낌표(그 뒤에 닫는 따옴표·괄호가 붙을 수 있음) 다음 공백에서 나눈다
  - 숫자 뒤 마침표(「1. 지원 동기」 같은 문항 번호)에서는 나누지 않는다. 문항 제목 줄도 한 문장이다
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

## 3. SCORE_ANSWER: 답변 채점

면접 중 답변마다 말하기 분석과 평가 STEP 01(기준별 판정)을 미리 한다. 다음 질문을 막지 않고, 실패해도 면접은 계속된다(EVALUATE가 마저 채점).

- **시작** BE가 답변을 저장한 직후(화상은 `answer.completed`, 채팅은 5.7). `answers.evaluation`이 비어 있을 때만 작업을 넣는다
- **입력(작업 메시지)** `answerId`, `mode`, `seq`, `question`, `criteria`, `content`, `tokens`(화상), `speech`(화상, `answers.speech`) **[제안]**. 고도화에서는 회사 공시 요약을 더한다
- **말하기 분석(화상만)** 입력은 `tokens`와 작업 메시지의 `speech`
  - 말하기 지표는 답변마다 구하는 5개(군말·긴 멈춤·말 속도·말끝 흐림·억양 폭, API 명세 6.3 `speechMetrics`에서 `gazeRatio`를 제외한 것)다. 시선 비율은 녹화 영상으로 면접 단위로 구하므로 판정에 사용하지 않는다
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
  - 판정이 없거나 3단계 밖이면 구조 깨짐으로 보고 재시도한다(5장)
  - `COVER_LETTER`는 여기서 임시 판정하고 EVALUATE에서 확정한다
  - `DELIVERY`는 화상이면 답변 글과 말하기 지표로, 채팅이면 답변 글로 판정한다. 비어 있는 지표는 빼고 판정하고, 지표가 모두 비어 있으면 답변 글로만 판정한다
- **결과** `answer.scored`에 `answerId`와 아래 `evaluation`을 담는다. BE는 `answers.evaluation`이 비어 있을 때만 저장한다

```json
{
  "criteria": {
    "JOB_FIT": { "level": 3, "score": 86, "reason": "직무 요구 기술과 경험을 연결함" },
    "COVER_LETTER": { "level": 2, "score": 71, "reason": "임시 판정" },
    "LOGIC": { "level": 3, "score": 88, "reason": "원인 → 조치 → 결과 순서가 분명함" },
    "DELIVERY": { "level": 2, "score": 69, "reason": "핵심이 뒤에 나옴" }
  },
  "scoreMethod": "PROBABILITY",
  "speech": { "fillerCount": 3, "speakingMs": 41000, "longPauseCount": 1, "syllablesPerMin": 310, "trailingOffRatio": 12.5, "pitchRangeSt": 6.2 },
  "promptVersion": "…",
  "modelVersion": "…"
}
```

## 4. EVALUATE: 결과 만들기

면접이 끝나면 남은 채점을 마치고 평가 STEP 02(자소서 대조)와 피드백을 만든다. 단계는 5.2의 `analysisStep`과 같다.

- **시작** 5.8(답변 ≥1)·5.9
- **입력(작업 메시지)** **[제안]** `mode`, `coverLetter`, `claims`, 답한 질문마다 `answerId`·`seq`·`question`·`criteria`·`content`·`tokens`·`speech`(화상, `answers.speech`)·`evaluation`(SCORE_ANSWER가 이미 채점했으면 그 값, 아니면 null). 고도화에서는 회사 공시 요약을 더한다
- 답이 없는 질문(중간 종료)은 메시지에 넣지 않는다

| 단계 | 하는 일 |
|---|---|
| `ORGANIZING_ANSWERS` 답변 정리 | `evaluation`이 null인 답변을 3장과 같은 방식으로 채점한다(이미 있는 값은 유지). 화상이면 답변별 지표를 합쳐 `speech_metrics`를 만든다 |
| `SCORING` 기준별 분석 | STEP 02 자소서 대조: 자소서 원문·`claims`와 답변을 대조해 근거가 맞는지 확인하고 `COVER_LETTER` 판정을 확정한다. 그다음 답변 점수 = 4항목 평균, 항목 점수 = 답한 질문들의 항목별 평균(정수) |
| `WRITING_FEEDBACK` 피드백 작성 | 답변마다 잘한 점·고칠 점, 항목마다 코멘트(255자 이하), 면접 총평(255자 이하). 고도화에서는 회사 공시 요약을 더한다 |

- 단계가 바뀔 때마다 `evaluation.progress`를 보낸다
- **결과** `evaluation.completed`에 다음을 담는다 **[제안]**
  - `answers[]`: `answerId`, `score`, `goodPoint`, `improvePoint`, `evaluation`(`COVER_LETTER` 확정본)
  - `sessionScores[]`: `criterion`, `score`, `comment`
  - `speechMetrics`(화상만, 채팅은 null, 아래 집계), `summary`
- 답변끼리 어긋나는 내용(같은 경험의 수치·역할이 답변마다 다름)은 답변 전체를 함께 보고 `summary`와 해당 답변의 `improvePoint`에 기록한다. 결과 화면에 표시되는 글이 총평과 질문별 잘한 점·아쉬운 점이기 때문이다
- BE는 한 트랜잭션에서 이 면접의 `session_scores`·`speech_metrics` 행과 `answers`의 점수·피드백을 지우고 다시 쓴 뒤 `COMPLETED`로 바꾼다(5.9로 다시 돌 때 유일성 제약 충돌 방지)
- `grade`는 보내지 않는다. BE가 점수로 계산한다(API 명세 6.3)

**`speech_metrics` 집계**

| 컬럼 | `speechMetrics` 키 | 계산 |
|---|---|---|
| `filler_per_min` | `fillerPerMin` | 전체 군말 수 ÷ 전체 말한 분(소수 둘째 자리) |
| `long_pause_count` | `longPauseCount` | 답변별 합계 |
| `speed_deviation_pct` | `speedDeviationPct` | (면접 말 속도 − 265) ÷ 265 × 100(%, 소수 둘째 자리). 면접 말 속도는 답변별 `syllablesPerMin`(3장)을 발화 시간(`speakingMs`)으로 가중한 평균이고, 265는 일반 성인의 대화 말 속도(음절/분)다 |
| `trailing_off_ratio` · `pitch_range_st` | `trailingOffRatio` · `pitchRangeSt` | 말한 시간으로 가중한 평균 |
| `gaze_ratio` | 키를 전송하지 않음 | 이 작업에서 사용하지 않음(API 명세 B-14) |

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

면접방(LiveKit)에 참가자로 들어가 면접을 진행한다. 질문을 말하고, 지원자 음성을 알아듣고, 리액션을 정하고, 답변이 끝났는지 판단해 BE에 넘긴다. LiveKit Agents(Python)로 만들고 STT·TTS는 공식 플러그인(Soniox · ElevenLabs)을 쓴다. 화면 동작은 [API 명세 면접방 메시지](API-명세.md#면접방-메시지-livekit)를 따른다.

### 6.1 배정

BE가 5.4에서 LiveKit `AgentDispatchService.CreateDispatch`로 에이전트를 면접방에 배정한다. 에이전트는 이름을 지정한 배정만 받는다.

| 항목 | 값 |
|---|---|
| 에이전트 이름 | `a301-interviewer` **[제안]** |
| 방 이름 | `interview-{sessionId}` **[제안]**(API 명세 B-20) |
| 배정 정보(metadata, JSON, 512KiB 이하) | 아래 **[제안]** |

```json
{ "sessionId": 55, "mode": "VIDEO", "persona": "DEVIL", "currentSeq": 1,
  "questions": [
    { "seq": 1, "content": "응답 시간을 40% 줄인 과정은?", "criteria": "원인 분석 · 수치 근거" }
  ] }
```

- `questions`는 5개 전부. 에이전트는 DB를 읽지 않으므로 질문 글과 채점 기준을 여기서 받는다
- `currentSeq`: 몇 번 질문부터 할지. 처음엔 1이고, 에이전트가 중간에 끊겨 다시 배정할 때 이어 갈 번호다
- 면접이 끝나면 BE가 방을 삭제(`RoomService.DeleteRoom`)하고 에이전트는 그 면접을 정리한다. 끝나지 않은 답변은 보내지 않는다

### 6.2 진행 흐름

질문마다 다음을 반복한다(1~5번).

1. **질문** `question.started` 결과 메시지(`seq`, `startedAt`)를 보내고, 면접방 메시지 `question`(`started`)을 보낸 뒤 질문 글을 TTS로 말한다. 다 말하면 `question`(`ended`), 합성에 실패하면 `failed`
2. **듣기(화상)** 지원자 음성을 STT로 수신해 확정 토큰과 시각을 수집한다. 같은 음성으로 말끝 흐림·억양 폭(3장)을 계산한다. 자막은 전송하지 않는다
3. **리액션** 화상은 문장이 끝날 때마다(문장 끝 기준은 API 명세 면접방 메시지), 채팅은 `chat.input`을 받을 때마다 Jev로 판단해 `reaction`을 보낸다(6.4)
4. **답변 끝(화상)** 마지막 말소리 뒤 7초 침묵(임시 값) 또는 `answer.submit`이면 답변을 끝낸다. 한마디도 안 했으면 끝내지 않고, 60초(임시 값) 동안 말을 시작하지 않으면 `answer.state`(`timedOut`)를 보낸다
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
- **채팅** 답변은 화면이 5.7로 BE에 낸다. 에이전트가 다음 질문으로 넘어갈 신호는 화면이 5.7 성공 뒤 `answer.submit`을 보내는 것으로 한다 **[제안]**
- 5번 질문의 답변이 끝나면 더 말하지 않는다. 면접 끝내기와의 순서는 API 명세 B-18 **[미정]**

### 6.3 면접방 메시지 형식 **[제안]**

LiveKit RPC를 쓴다. 본문은 JSON 문자열(15KiB 이하)이다. 질문은 `seq`(질문 순서 1~5)로 가리키고, 리액션·채팅 입력은 `seq`를 메시지 순번으로 사용하므로 질문을 `questionSeq`로 가리킨다. 메시지 종류와 화면 동작은 API 명세 면접방 메시지를 따른다.

모든 메시지에 공통 필드 `type`(메시지 종류, API 명세 면접방 메시지 표의 메시지 이름)과 `sessionId`(면접 id)를 담는다. 아래 표의 필드는 공통 필드를 제외한 것이다.

| RPC 메서드 | 방향 | 필드 |
|---|---|---|
| `interview.question` | 에이전트 → 화면 | `seq`, `content`, `speech`(`started`·`ended`·`failed`), `alignment`(`started`에만. `chars[]` = `{ char, startMs, endMs }`, 질문 음성 맨 앞이 0) |
| `interview.reaction` | 에이전트 → 화면 | `questionSeq`(질문 순서), `seq`(그 답변 안에서 1부터 증가, 화면은 가장 큰 값만 씀), `reaction`(`type`·`expression`·`gesture`·`intensity`·`durationMs`, 판단하지 못했거나 반응할 내용이 없으면 null), `attitude`(`interest`·`trust`, 0~1, 첫 판단 전에는 0.5), `interrupt`(`reason`: `OFF_TOPIC`·`TOO_LONG`, `text`, 채팅은 항상 null) |
| `interview.answerState` | 에이전트 → 화면 | `seq`(질문 순서), `state`: `autoSubmitted` · `timedOut` · `sttReconnecting` · `sttFailed` · `submitted` · `submitFailed` |
| `interview.answerSubmit` | 화면 → 에이전트 | `seq`(질문 순서). 응답 `{ "accepted": true }`, 이미 제출 중이면 `false` |
| `interview.chatInput` | 화면 → 에이전트 | `questionSeq`(질문 순서), `seq`(그 답변 안에서 1부터 증가), `text`(입력 칸 전체, 1,000자 이하), `pauseMs` |

- RPC 오류: `2001 EMPTY_ANSWER`(한마디도 안 함), `2002 NOT_ANSWERING`(질문 음성 재생 중 등). 1001~1999는 LiveKit 예약
- 발음 시각이 15KiB를 넘으면 나눠 보낼지 텍스트 스트림을 쓸지 **[미정]**
- 말 끊기(`interrupt`)의 `text`는 에이전트가 음성으로도 말한다
- `reaction.durationMs`는 1,200ms다. 리액션이 없을 때와 `durationMs`가 지난 뒤 면접관은 기본 상태(듣는 중 `listening`, 무표정)다

### 6.4 리액션 판단 (Jev)

- 입력: 질문·채점 기준(배정 정보), 전송된 글(문장 또는 채팅 입력)과 쉰 시간, 지금까지의 답변 글, 직전 태도(`attitude`). 면접 방식은 발화 중단을 판단할지 정하는 데만 쓴다. 최근 글·태도는 에이전트가 면접 동안 메모리에 둔다
- 면접관 종류(`persona`)는 넣지 않는다. 리액션 값은 면접관과 관계없고 화면이 면접관별로 표현을 달리하므로(API 명세 B-8) 판단에 필요하지 않다
- Jev(`POST /v1/systemone`, 질문 유형 `choice`·`score`·`noul`)로 `reaction`·`attitude`를 판단한다. 모델은 버전 ID `jev-1.14.0`으로 고정한다. 별칭(`jev-latest`)은 새 버전이 나오면 코드 변경 없이 호출 모델이 변경돼 리액션·발화 중단 기준값이 맞지 않게 되기 때문이다
- 발화 중단(`interrupt`) 중 질문 이탈(`OFF_TOPIC`)은 Jev로 판단하고, 지나치게 긴 답변(`TOO_LONG`)은 발화 시간(3장 `speakingMs`)으로 코드에서 판단한다. 수치 비교는 Jev가 아니라 코드에서 처리한다. Jev는 글을 생성하지 않으므로 `interrupt.text`는 이유(`reason`)·면접관별로 설정에 둔 문구를 사용한다. 채팅이면 발화 중단은 판단하지 않는다
- 0.8초(임시 값) 안에 답을 받지 못하거나 호출이 실패하면 `reaction: null`, `attitude`는 직전 값으로 보낸다

### 6.5 실패 처리

| 상황 | 처리 |
|---|---|
| Jev 늦음·실패 | 그 문장은 리액션 없이 넘어감(6.4) |
| STT 끊김 | 재연결하며 `sttReconnecting`. 실패하면 `sttFailed`, 화면 처리는 **[미정]** |
| TTS 실패 | `question`에 `failed`. 화면은 질문 글로 진행 |
| 결과 큐에 넣기 실패 | 1·2·4초 간격으로 3회 재시도(5장). 답변 완료(`answer.completed`)가 재시도 후에도 실패하면 `answer.state`로 `submitFailed`를 전송하고, 화면 처리는 **[미정]**. 같은 결과가 두 번 전송돼도 BE가 제외한다 |
| 에이전트가 면접 도중 끊김 | BE가 `currentSeq`를 넣어 다시 배정한다. 누가 끊김을 알아채고 언제 다시 배정할지 **[미정]** |
| 동시 면접 상한 초과 | 배정을 거절한다. BE · 화면 처리 **[미정]**(API 명세 B-17) |

## 7. MERGE_RECORDING: 녹화 합치기

화상 면접이 끝나면 Egress가 저장한 트랙(지원자 영상·음성, 면접관 음성)을 mp4 하나로 합친다(운영 배포 계획 4.3).

- **시작** 5.8(화상). 면접 중이 아니라 끝난 뒤 큐 작업으로 하므로 면접 중 CPU를 쓰지 않는다
- **입력(작업 메시지)**
  - `rawPrefix`: 원본 트랙 위치. S3 `recordings/raw/{sessionId}/`로 시작하고, BE가 녹화를 시작할 때 정한다
  - `objectKey`: 결과 위치 `recordings/{sessionId}.mp4`
  - 다른 면접의 녹화를 읽거나 덮어쓰지 않도록, 두 값이 그 작업 `sessionId`의 위치가 아니면 형식 오류(1.3)로 처리한다
- **원본 트랙 파일** `rawPrefix` 아래 `candidate-video.webm`(지원자 영상), `candidate-audio.ogg`(지원자 음성), `interviewer-audio.ogg`(면접관 음성). BE가 Egress 트랙 녹화를 시작할 때 이 이름으로 저장한다
- **처리** ffmpeg로 합쳐 S3에 올린다
- **결과** `recording.merged`(`objectKey`). 실패하면 `recording.mergeFailed`(`TRACK_NOT_FOUND`·`STORAGE_ERROR`·`MERGE_ERROR`·`INVALID_JOB`·`INTERNAL_ERROR`, 1.4). 같은 작업을 다시 처리해도 결과가 같을 가능성이 높으므로 재시도하지 않는다. 다시보기 처리는 **[미정]**(API 명세 B-19)

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
| LiveKit Egress 트랙 녹화의 실제 파일 형식과 저장 완료 시점 | 7장 원본 트랙 파일 |
| LiveKit Soniox 플러그인에서 확정 토큰·토큰 시각·끝 감지(`<end>`)를 그대로 받을 수 있는지 | 6.2 `tokens`, 문장 끝 판단, 3장 말하기 분석 |
| LiveKit ElevenLabs 플러그인에서 글자별 발음 시각을 받을 수 있는지(문서에서 확인한 것은 자막 맞춤 `use_tts_aligned_transcript`뿐) | 6.3 `alignment` |
