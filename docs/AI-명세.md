# A301 AI 명세

> 면접 AI(질문·채점 기준 생성, 답변 채점, 결과 생성, 실시간 반응)의 내부 처리 계약이다. 화면이 보는 API 형식과 동작은 [API 명세](API-명세.md)와 Swagger에, AI 서비스의 DB·JWT 접근 범위는 [CONTRIBUTING 7장](CONTRIBUTING.md#7-음성websocketai-job-금지사항)에 두고, 이 문서에는 서버 안에서 주고받는 작업·입출력·실패 처리만 적는다.

## 목차

1. [구성](#1-구성)
2. [PLAN: 질문·채점 기준 만들기](#2-plan-질문채점-기준-만들기)
3. [SCORE_ANSWER: 답변 채점](#3-score_answer-답변-채점)
4. [EVALUATE: 결과 만들기](#4-evaluate-결과-만들기)
5. [실패 처리](#5-실패-처리)
6. [실시간 반응 서비스](#6-실시간-반응-서비스)
7. [회사 공시 요약 (고도화)](#7-회사-공시-요약-고도화)
8. [버전](#8-버전)
9. [확인 필요](#9-확인-필요)

## 1. 구성

```
브라우저 ─ Nginx ─┬─ BE(Spring)                    5.11을 뺀 모든 API
                  └─ AI 실시간 반응 서비스(FastAPI)  5.11

BE ─ Redis 작업 큐 ─ AI 분석 작업자                  PLAN · SCORE_ANSWER · EVALUATE

(고도화) DART → Lightsail(Airflow·MinIO·Spark) → S3 → 공시 요약 적재 작업자 → 메인 DB
```

- BE와 AI 서비스는 서로 직접 호출하지 않는다. BE는 DB 커밋과 함께 Outbox로 작업을 큐에 넣는다(CONTRIBUTING 6.2)
- 외부 서비스: GMS(LLM), Jev(면접관 반응), ElevenLabs(TTS, 브라우저 직접 연결), Soniox(STT, 브라우저 직접 연결)
- 평가 항목은 `JOB_FIT`(직무 적합성)·`COVER_LETTER`(자소서 검증)·`LOGIC`(논리성)·`DELIVERY`(전달력) 4개이고, 판정은 3단계(좋아요·보통·아쉬워요)다

### 1.1 작업별 쓰는 곳

| 주체 | 시작 | 쓰는 곳 |
|---|---|---|
| BE | 5.4(1번)·5.7(다음) | `interview_questions`. `created_at`은 질문을 낸 시각 |
| PLAN | 5.1·5.3 | `interview_plans`, Redis `planStatus`·`planProgress` |
| SCORE_ANSWER | 5.7 | `answers.evaluation` |
| EVALUATE | 5.8(답변 ≥1)·5.9 | `answers`의 `score`·`good_point`·`improve_point`·`evaluation`, `session_scores`, `speech_metrics`, `interview_sessions`의 `status`·`summary`, Redis `analysisStep` |
| 공시 요약 적재 | 공시 파이프라인 | 회사 요약 Table |

`interview_plans`, `answers.tokens`, `answers.evaluation`, 회사 요약 Table은 ERD 반영 대기다(API 명세 B-9).

### 1.2 Redis 진행 상태

- BE의 면접 진행 상태(`SessionRuntime`)를 함께 쓴다. 작업자는 `planStatus`·`planProgress`·`analysisStep`만 바꾸고 `pausedSeconds`는 건드리지 않는다. 키 이름은 BE가 정한다
- Redis 값이 없으면 `interview_plans` 행이 있을 때 `planStatus`를 `READY`로 본다

### 1.3 작업 메시지

```json
{ "jobType": "SCORE_ANSWER", "jobId": "8f0c…", "sessionId": 55, "answerId": 903 }
```

- `jobType`: `PLAN` · `SCORE_ANSWER` · `EVALUATE`. `answerId`는 `SCORE_ANSWER`만
- `jobId`는 추적용이다. 중복·늦은 메시지는 작업마다 정한 버림 조건과 조건부 쓰기로 막는다

| 경우 | 예 | 처리 |
|---|---|---|
| 정상 | PLAN 도착, `planStatus: GENERATING` | 처리 |
| 중복 수신 | 같은 SCORE_ANSWER가 두 번 도착 | 두 번째는 `evaluation`이 이미 있어 버림 |
| 순서 역전 | 5.3 재생성 뒤 실패했던 이전 PLAN이 늦게 도착 | 둘 다 돌아도 `interview_plans`는 먼저 쓴 결과만 남음 |

## 2. PLAN: 질문·채점 기준 만들기

면접 전에 자소서에서 주장을 뽑고, 그 주장을 파고드는 질문 5개와 질문마다 채점 기준 1개를 만든다.

- **시작** 5.1·5.3. `planStatus`가 `GENERATING`이 아니거나 `interview_plans` 행이 이미 있으면 버린다
- **입력** `applications`의 회사·직무·자소서. 고도화에서는 회사 공시 요약(7장)을 STEP 01에 더한다
- **STEP 01 주장 추출(GMS)** 자소서에서 경험·수치를 뽑는다. `sentenceNo`는 자소서 원문의 문장 순번이다
- **STEP 02 질문·기준 생성(GMS)** 주장마다 파고드는 질문과 채점 기준을 JSON으로 만든다

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
- **검증** JSON이 아니거나 질문이 5개가 아니면 1회 재시도 후 `FAILED`. `claimId`가 없는 주장을 가리키면 그 질문만 1회 다시 만들고, 그래도 틀리면 `FAILED`
- **진행률** STEP 01이 끝나면 `planProgress` 50, STEP 02가 끝나면 100과 `READY`
- **저장** `interview_plans(session_id PK·FK, claims, questions, prompt_version, model_version, created_at)`. `session_id`가 이미 있으면 쓰지 않는다
- **질문 출제** BE가 5.4·5.7 처리 중 `questions[seq]`를 `interview_questions`에 넣는다. 질문 수는 5개 고정이고, 5번 질문에 답하면 `isLastQuestion`이 true다

## 3. SCORE_ANSWER: 답변 채점

면접 중 답변마다 말하기 분석과 평가 STEP 01(기준별 판정)을 미리 한다. 다음 질문을 막지 않고, 실패해도 면접은 계속된다(EVALUATE가 마저 채점).

- **시작** 5.7. `answers.evaluation`이 이미 있으면 버리고, 쓸 때도 `evaluation IS NULL`일 때만 쓴다
- **말하기 분석(화상만)** 입력은 `answers.tokens`와 답변 음성 파일(`recordings`의 `ANSWER_AUDIO`)
  - 말하기 지표는 답변 음성으로 구하는 5개(군말·긴 멈춤·말 속도·말끝 흐림·억양 폭, 6.3 `speechMetrics`에서 `gazeRatio`를 뺀 것)다. 시선 비율은 녹화 영상으로 면접 단위로 구하므로 판정에 쓰지 않는다
  - `tokens`는 공백 토큰을 경계로 단어로 묶는다
  - `tokens`로 군말 수·말한 시간·긴 멈춤 수·말 속도를, 음성 파일로 말끝 흐림·억양 폭을 구한다
  - `tokens`가 없거나 구하지 못한 지표는 비워 둔다
- **판정 입력** 질문, 채점 기준(`interview_plans.questions[seq].criteria`), 답변 `content`. 화상은 `DELIVERY` 판정에 그 답변의 말하기 지표를 더한다. 고도화에서는 회사 공시 요약을 더한다
- **판정** 채점 기준을 잣대로 평가 항목 4개를 3단계로 판정한다(G-Eval)
  - 항목마다 판정 이유와 3단계(`level` 1 아쉬워요 · 2 보통 · 3 좋아요)를 받는다
  - 점수는 3단계(50·70·90)의 확률로 낸 기대값이다(`PROBABILITY`). 확률을 받지 못하면 판정한 단계의 점수를 그대로 쓴다(`FIXED`). 정수로 반올림한다
  - 판정이 없거나 3단계 밖이면 구조 깨짐으로 보고 재시도한다(5장)
  - `COVER_LETTER`는 여기서 임시 판정하고 EVALUATE에서 확정한다
  - `DELIVERY`는 화상이면 답변 글과 말하기 지표로, 채팅이면 답변 글로 판정한다. 비어 있는 지표는 빼고 판정하고, 지표가 모두 비어 있으면 답변 글로만 판정한다
- **저장** `answers.evaluation`

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

- **시작** 5.8(답변 ≥1)·5.9. 면접 행을 잠그고(`SELECT … FOR UPDATE`) `status`가 `ANALYZING`이 아니면 버린다
- 시작할 때 이 면접의 `session_scores`·`speech_metrics` 행과 `answers`의 점수·피드백을 지우고, 같은 트랜잭션에서 다시 쓴다(5.9로 다시 돌 때 유일성 제약 충돌 방지)
- 답이 없는 질문(중간 종료)은 채점·피드백에서 뺀다

| 단계 | 하는 일 |
|---|---|
| `ORGANIZING_ANSWERS` 답변 정리 | `evaluation`이 없는 답변을 3장과 같은 방식으로 채점한다(먼저 쓴 결과는 유지). 화상이면 답변별 지표를 합쳐 `speech_metrics`를 만든다 |
| `SCORING` 기준별 분석 | STEP 02 자소서 대조: 자소서 원문·`claims`와 답변을 대조해 근거가 맞는지 확인하고 `COVER_LETTER` 판정을 확정해 `answers.evaluation`에 덮어쓴다. 그다음 `answers.score` = 4항목 평균, `session_scores.score` = 답한 질문들의 항목별 평균(정수) |
| `WRITING_FEEDBACK` 피드백 작성 | 답변마다 `good_point`·`improve_point`, 항목마다 `session_scores.comment`(255자 이하), 면접 `summary`(255자 이하). 고도화에서는 회사 공시 요약을 더한다 |

- 끝나면 `status`를 `COMPLETED`로 바꾸고 Redis `analysisStep`을 비운다
- `grade`는 저장하지 않는다. BE가 점수로 계산한다(API 명세 6.3)

**`speech_metrics` 집계**

| 컬럼 | 계산 |
|---|---|
| `filler_per_min` | 전체 군말 수 ÷ 전체 말한 분 |
| `long_pause_count` | 답변별 합계 |
| `speed_deviation_pct` | 기준 미정(B-13) |
| `trailing_off_ratio` · `pitch_range_st` | 말한 시간으로 가중한 평균 |
| `gaze_ratio` | 이 작업에서 쓰지 않음(B-14) |

## 5. 실패 처리

| 상황 | 처리 |
|---|---|
| GMS 타임아웃·429·5xx | 3회 재시도. 다 실패하면 PLAN은 `planStatus: FAILED`, EVALUATE는 `status: FAILED`. SCORE_ANSWER는 상태를 바꾸지 않고 EVALUATE에 맡긴다 |
| 출력 구조 깨짐(JSON 아님, 개수·판정 값 틀림) | 1회 재시도 후 위와 같이 처리 |
| 확률만 없음 | 그 항목만 `FIXED`로 점수를 내고 로그를 남긴다 |
| 작업자 중단·메시지 유실 | 최대 대기 시간이 지나면 BE가 5.2 조회 때 `FAILED`로 바꾼다(값은 B-11) |

`FAILED`가 되면 화면은 5.3(플랜)·5.9(결과)로 다시 시도한다.

## 6. 실시간 반응 서비스

인증·오류 형식은 CONTRIBUTING 7장, 화면 동작은 API 명세 5.11을 따른다.

**5.11 면접관 리액션**
- 입력: 질문·채점 기준(`interview_plans`), 보낸 문장·`pauseMs`, 서비스가 따로 두는 Redis의 최근 문장·태도
- Jev(`POST /v1/systemone`, 질문 유형 `choice`·`score`·`noul`)로 `reaction`·`attitude`와 말 끊기 여부를 판단하고, 최근 문장·태도를 Redis에 갱신한다. Jev는 글을 만들지 않으므로 `interrupt.text`는 이유(`reason`)·면접관별로 서비스 설정에 둔 문구를 쓴다
- `ttlMs` 안에 답을 받지 못하거나 호출이 실패하면 `reaction: null`, `attitude`는 직전 값으로 200을 준다

## 7. 회사 공시 요약 (고도화)

DART 공시를 수집·정제(중복 제거·기업명 매칭)하고 LLM으로 출처가 붙은 요약을 만들어 S3에 올리면, 공시 요약 적재 작업자가 메인 DB 회사 요약 Table에 넣는다.

```json
{ "companyName": "○○전자", "summary": "…",
  "sources": [ { "title": "사업보고서 (2026.03)", "url": "https://dart.fss.or.kr/…", "publishedAt": "2026-03-14" } ] }
```

- 지원서와는 `applications.company_name`의 기업명 매칭 결과로 잇는다
- PLAN STEP 01, SCORE_ANSWER 판정, EVALUATE 피드백 입력에 더한다. 요약이 없으면 빼고 그대로 진행한다

## 8. 버전

등록된 Prompt·Model·Rubric 버전만 쓴다(CONTRIBUTING 7장). PLAN은 `interview_plans`, SCORE_ANSWER는 `answers.evaluation`에 남기고, EVALUATE는 로그에만 남긴다(DB 저장은 범위 제외).

## 9. 확인 필요

| 내용 | 영향 |
|---|---|
| GMS가 토큰 확률(logprobs)을 주는지 | 3장 점수 방식(`PROBABILITY`/`FIXED`) |
| Jev 질문 구성(리액션·태도·말 끊기를 어떤 질문 유형으로 물을지), 한국어 답변에서의 정확도, 응답 시간 | 6장 5.11 |
| 군말 목록, 긴 멈춤 기준 시간 | 3장 말하기 분석 |
| Soniox 시각 기준점(API 명세 5.7) | 3장 말하기 분석 |
