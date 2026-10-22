# A301 BE 설계

> API 계약은 목 서버(`mock/`)의 Swagger(`/docs`)와 [API 명세](API-명세.md)가 기준이다. Swagger는 API별 요청·응답을, 명세 문서는 공통 규약·업무 규칙·보류 목록을 담는다. 이 문서는 그 API를 **어떻게 구현하는지**를 적는다.
> 표기: **[결정]** 팀에서 정한 것 · **[제안]** 이 문서가 제안하는 것(확정 전) · **[미정]** 보류 목록([API 명세 4장](API-명세.md#4-보류--확인-필요-b) B-번호)

## 1. 범위 · 스택

| 항목 | 내용 |
|---|---|
| 런타임 | Java 21, Spring Boot 4.1.x |
| 저장소 | PostgreSQL 18.x(영구 데이터), Redis(진행 중 상태·토큰·멱등 키) |
| 파일 | S3. DB에는 `object_key`만 저장 **[결정]** |
| 스키마 | Flyway `backend/src/main/resources/db/migration`. JPA는 `ddl-auto: validate`로 엔티티와 DDL이 어긋나면 기동 실패 |
| 시간 | 저장은 `timestamptz`, 응답은 `+09:00`. "날짜"(연습일)는 한국 시간 기준 **[결정]** |

- DB에서 읽은 일시는 UTC 오프셋으로 나온다(같은 시각). 응답의 `+09:00`은 Jackson 설정 `spring.jackson.time-zone: Asia/Seoul`이 맡는다(목 서버와 같음)

## 2. 폴더 · 패키지 구조

| 폴더 | 역할 |
|---|---|
| `mock/` | API별 요청·응답(Swagger)과 예시 응답. 실제 로직·DB 없음. FE가 실제 백엔드 완성 전에 붙여 개발 |
| `backend/` | 실제 백엔드. DB 스키마·도메인·DTO·Mapper와 회원가입·인증 API 구현 |

두 폴더 모두 패키지는 `com.ssafy.a301`이고, 포맷·정적 분석 규칙이 같다. API를 `backend/`에 구현하면 그 API는 `backend/`의 Swagger가 기준이 되고, 모두 구현되면 `mock/`의 Controller·Swagger 설정을 `backend/`로 옮긴 뒤 `mock/`을 지운다 **[결정]**.

`backend/`는 기능(도메인)별 구성을 유지하고, 각 기능 내부는 역할별 하위 패키지로 나눈다. 구현된 계층만 만들며 빈 패키지는 미리 만들지 않는다.

```text
com.ssafy.a301
├─ auth
│  ├─ controller   AuthController
│  ├─ service      AuthService
│  ├─ dto          회원가입·로그인·재발급 등의 요청·응답 record(각각 별도 파일)
│  ├─ jwt          AccessTokens, AuthProperties
│  ├─ repository   RefreshTokenStore, RedisRefreshTokenStore
│  └─ config       SecurityConfig
├─ user
│  ├─ controller   UserController
│  ├─ service      UserService
│  ├─ dto          UserDtos
│  ├─ mapper       UserMapper
│  ├─ repository   UserRepository, UserAgreementRepository
│  └─ domain       User, UserAgreement, TermsType
├─ home
│  ├─ dto          HomeDtos
│  ├─ mapper       HomeMapper
│  ├─ repository   PracticeLogRepository
│  └─ domain       PracticeLog, Streak
├─ application
│  ├─ controller   ApplicationController
│  ├─ service      ApplicationService
│  ├─ dto          ApplicationDtos
│  ├─ mapper       ApplicationMapper
│  ├─ repository   ApplicationRepository
│  └─ domain       Application
├─ interview
│  ├─ controller   InterviewSessionController
│  ├─ service      SttTokenService, TtsTokenService, AiJobService·AiJobPublisher(Outbox), SessionRuntimeService
│  ├─ dto          InterviewDtos
│  ├─ mapper       InterviewMapper
│  ├─ repository   InterviewSessionRepository, InterviewQuestionRepository, InterviewPlanRepository,
│  │               AiJobRepository, AiJobQueue·RedisAiJobQueue, SessionRuntimeStore·RedisSessionRuntimeStore
│  ├─ stt          SonioxClient
│  ├─ tts          ElevenLabsClient
│  └─ domain       면접·플랜·질문·답변·녹화·점수·음성 지표·AI 작업·상태 enum
├─ result
│  ├─ dto          ResultDtos
│  └─ mapper       ResultMapper
├─ growth/dto      GrowthDtos
├─ storage
│  ├─ s3           S3FileStorage, S3Config, S3Properties, PresignedUrl
│  ├─ repository   UploadKeyStore, RedisUploadKeyStore
│  └─ domain       UploadPurpose
├─ common/error    ErrorCode, ApiException, FieldValidationException, GlobalExceptionHandler
├─ common/idempotency  Idempotent, IdempotencyInterceptor·Filter·Config, IdempotencyStore, RedisIdempotencyStore
└─ config          OpenApiConfig, SchedulingConfig
```

- `controller`: HTTP 요청·검증·응답, `service`: 업무 흐름·트랜잭션, `repository`: DB·Redis 접근, `dto`: 요청·응답, `mapper`: 엔티티 → 응답 변환, `domain`: 엔티티·상태 전이·enum을 담당한다.
- 인증 DTO는 개별 record 파일로 분리했다. 다른 기능의 기존 `*Dtos` 중첩 record는 `dto` 패키지로 이동해 유지한다.
- 현재 인증 Controller·Service, 회원 정보·프로필·탈퇴(2.1~2.7)·지원서(4.1~4.5) Controller·Service, 면접 만들기~지금 질문(5.1~5.5)·음성 인식·질문 음성 토큰(5.10·5.12) Controller·Service와 Soniox·ElevenLabs 어댑터, 회원·지원서·연습 기록 Repository, JWT Security, Redis 토큰·업로드 키 저장소, S3 파일 어댑터, 면접 플랜 조회 Repository, 멱등성 처리(8장), AI 작업 Outbox·큐 전송과 진행 상태 저장소(5장 5.0·7장)와 공통 오류 처리·Swagger가 구현되어 있다. 다른 기능의 Controller·Service·Repository는 후속 구현 대상이다.

- 변환 규칙: **엔티티 → 응답 DTO는 `*Mapper`의 정적 메서드**로만 한다. 계산값(스트릭, `inUse`, 임시 주소 등)은 서비스가 구해서 Mapper 인자로 넘긴다. 엔티티를 응답으로 그대로 내보내지 않는다 **[제안]**
- enum: DB에 저장하는 값과 API 값이 같은 enum은 `domain`에 하나만 두고 DTO도 그것을 쓴다. API에서 받는 값이 더 좁은 녹화 종류(`SESSION_VIDEO`만)는 DTO 전용 enum을 둔다

## 3. 도메인 모델 (엔티티 ↔ ERD)

가입은 필수 약관 3개(`TERMS`·`PRIVACY`·`RECORDING`)와 화면에 표시한 버전을 모두 저장한다. 하나라도 빠지면 400 `AGREEMENT_REQUIRED`.

| 엔티티 | 테이블 | 연관 | 비고 |
|---|---|---|---|
| `User` | `users` | - | 탈퇴는 soft delete: `deleted_at`만 기록하고 행·관련 데이터·파일은 남긴 채 조회에서 제외. 이메일은 **탈퇴하지 않은 회원끼리만** 중복 불가(부분 UNIQUE 인덱스) **[결정]** |
| `UserAgreement` | `user_agreements` | N:1 User | 가입 시 TERMS·PRIVACY·RECORDING 3개 모두 기록 **[결정]** |
| `Application` | `applications` | N:1 User | 저장해 두고 재사용. 면접에 쓴 지원서는 수정·삭제 불가(409 `APPLICATION_IN_USE`) **[결정]**. 삭제는 실제 삭제 |
| `InterviewSession` | `interview_sessions` | N:1 User, N:1 Application | 상태 전이는 엔티티 메서드로만(4장) |
| `InterviewQuestion` | `interview_questions` | N:1 Session | **질문을 화면에 낸 시점에 행 생성** **[결정]**. `(session_id, seq)` UNIQUE **[제안]** |
| `AiJob` | `ai_job_outbox` | - | AI 작업 Outbox(5.0). id = 메시지의 `jobId`(UUID). 보낸 기록 로그라 면접·답변에 외래키 없음. 큐에 보내면 `published_at` |
| `InterviewPlan` | `interview_plans` | 1:1 Session(PK 공유) | 질문 5개·질문별 채점 기준(JSONB). AI 분석 작업자(PLAN)가 쓰고 BE는 읽기만 한다(`@Immutable`). `claims`·버전은 AI만 써서 매핑하지 않음 |
| `Answer` | `answers` | 1:1 Question | `question_id` UNIQUE. 점수·피드백은 결과 생성 때 채움. `tokens`(JSONB, 5.7 화상 확정 토큰)는 BE가 저장. `evaluation`(JSONB, SCORE_ANSWER 판정)은 AI 분석 작업자만 쓰므로 엔티티에 매핑하지 않는다(BE가 답변을 고쳐도 덮어쓰지 않도록) |
| `Recording` | `recordings` | N:1 Session, N:1 Answer(null 가능) | `ANSWER_AUDIO`(5.7, answer 연결) · `SESSION_VIDEO`(6.2, 면접당 1개는 서비스에서 확인). `object_key` UNIQUE |
| `SessionScore` | `session_scores` | N:1 Session | `(session_id, criterion)` UNIQUE. 기준 4개 |
| `SpeechMetric` | `speech_metrics` | 1:1 Session(PK 공유) | 화상만. `gaze_ratio`는 녹화 영상에서, 나머지는 답변 음성에서 |
| `PracticeLog` | `practice_logs` | N:1 User | **연습한 날** 기록(스트릭·달력용). `(user_id, practice_date)` UNIQUE라 날짜당 한 건. 면접은 하루에 여러 번 볼 수 있고 그 기록은 `interview_sessions`에 면접마다 남는다 |

- 회원 정보 변경(2.2·2.3·2.5·2.6)과 탈퇴(2.7)는 회원 행을 잠그고(`SELECT … FOR UPDATE`) 트랜잭션 안에서 바꾼다. 같은 회원의 요청이 겹쳐도 서로 덮어쓰지 않고, 탈퇴 뒤에 처리되는 변경은 401이 된다. S3 파일 삭제·토큰 폐기는 커밋 뒤에 한다
- 지원서 수정·삭제(4.4·4.5)는 지원서 행을 잠그고(`SELECT … FOR UPDATE`) 사용 여부(`inUse`)를 확인한다. 면접 만들기(5.1)도 같은 행을 잠그면 "사용 중" 확인과 겹치지 않는다. 그래도 삭제가 외래키(`interview_sessions.application_id`)에 걸리면 409 `APPLICATION_IN_USE`로 응답한다
- 지원서 목록(4.3)은 최근 작성 순(같은 시각이면 id 역순)이고, 항목별 `inUse`는 한 번의 조회로 구한다
- 모든 연관은 `LAZY`. 응답에 회사명·직무가 필요한 조회(5.2, 6.3, 6.4, 7.2)는 `application`을 fetch join한다 **[제안]**
- 다른 회원의 리소스는 404로 응답한다 **[결정]**. 조회 조건에 항상 `user_id`를 넣어 "없음"과 "남의 것"을 같은 결과로 만든다 **[제안]**
- ERD에 없고 DDL에만 추가한 것 **[제안]**: `ix_applications_user_created`(지원서 목록), `ix_interview_sessions_user_ended`(홈·통계), `ix_interview_sessions_application`(지원서 사용 여부), `uk_interview_questions_session_seq`(질문 순서 중복 방지)

## 4. 면접 상태 전이

| 현재 | 요청 | 다음 | 엔티티 메서드 | 조건 |
|---|---|---|---|---|
| `READY` | 5.4 시작 | `IN_PROGRESS` | `start(now)` | 플랜 `READY`(Redis) 아니면 409 `PLAN_NOT_READY` |
| `IN_PROGRESS` | 5.8 끝내기(답변 ≥1) | `ANALYZING` | `end(now, answeredCount)` → true | 연습 기록 남김(6.1) |
| `IN_PROGRESS` | 5.8 끝내기(답변 0) | `ABORTED` | `end(now, 0)` → false | 결과·연습 인정 없음 |
| `ANALYZING` | 결과 생성 완료 | `COMPLETED` | `complete(summary)` | |
| `ANALYZING` | 결과 생성 실패 | `FAILED` | `failAnalysis()` | |
| `FAILED` | 5.9 재생성 | `ANALYZING` | `retryAnalysis()` | |

허용되지 않는 전이는 엔티티가 409 `INVALID_SESSION_STATE`를 던진다.

## 5. 처리 흐름

### 5.0 AI 작업 전송 (Outbox) **[결정]**
1. 업무 트랜잭션 안에서 `AiJobService.enqueue(AiJob.plan/scoreAnswer/evaluate(...))`로 `ai_job_outbox`에 넣는다. 트랜잭션 밖에서 부르면 예외(업무가 롤백되면 작업도 남지 않음)
2. 커밋 직후 `AiJobPublisher`가 Redis `ai:jobs`에 `LPUSH`하고 `published_at`을 남긴다. 실패해도 업무 응답은 성공이다
3. 보내지 못한 작업은 5초(`ai-job.republish-interval`)마다 다시 보낸다. 행을 `FOR UPDATE SKIP LOCKED`로 잡아 같은 작업을 동시에 두 번 보내지 않는다
4. 큐에 넣은 뒤 기록에 실패하면 같은 작업이 한 번 더 갈 수 있다. 작업자가 AI 명세 1.3의 버림 조건으로 거른다
5. 작업자는 `BLMOVE ai:jobs ai:jobs:processing`으로 꺼내고 끝나면 처리 중 리스트에서 지운다(AI 쪽 구현)

### 5.1 면접 만들기 → 플랜 생성 (5.1, 5.3)
1. 지원서 소유 확인(지원서 행 잠금, 3장) → `InterviewSession`(READY) 저장 → Redis `startPlan`(planStatus GENERATING, planProgress 0) → PLAN 작업 enqueue(5.0). Redis 쓰기는 커밋 전(트랜잭션 안)에 한다. 커밋 뒤에 쓰면 작업자가 먼저 PLAN을 꺼내 GENERATING이 아니라며 버릴 수 있다. 5.3도 같다
2. 플랜 생성은 **비동기**(면접 AI 모듈 호출). 진행률을 Redis에 갱신한다. 화면은 5.2를 2초마다(임시 값, B-11) 불러 확인한다
   - 최대 대기 3분(`ai-job.plan-timeout`, B-11 임시 값) **[제안]**: 시작 시각(`planStartedAt`)부터 3분이 지나도 GENERATING이면 5.2 조회 때 FAILED로 바꾼다(AI 명세 5장). 아직 GENERATING일 때만 바꾸고(Lua), 그 사이 플랜 행이 저장됐으면 READY로 본다
3. 완료 → Redis `planStatus=READY` / 실패 → `FAILED`
4. 플랜(질문 5개·질문별 채점 기준)은 `interview_plans`에 저장한다(V2 마이그레이션, 형식은 AI 명세 2장). `interview_questions`에는 질문을 낼 때 넣는다 **[결정]**

### 5.2 질문 출제 (5.4, 5.7 이후)
- 다음 질문이 정해지는 순간 `InterviewQuestion(seq = 이전 + 1)`을 저장한다. 그 전까지 5.5는 202 `QUESTION_GENERATING`을 준다. 5개에 모두 답했으면 5.5는 409 `INVALID_SESSION_STATE`다(화면은 5.8) 이 `created_at`이 다시보기 마커 기준이다 **[결정]**
- 질문 음성은 5.12로 받는다. BE가 ElevenLabs 1회용 토큰(15분)을 발급하고 면접관별 `voiceId`, 모델 `eleven_multilingual_v2`를 정한다. 3초 안에 받지 못하거나 실패하면 503 `TTS_UNAVAILABLE` **[결정]**

### 5.3 답변 제출 (5.6, 5.7, 5.10)
1. 화상: 5.10으로 Soniox 1회용 임시 키 발급 → 브라우저가 Soniox에 직접 스트리밍 **[결정]**
2. 5.6으로 답변 음성 업로드 주소 발급 → 브라우저가 S3에 PUT
3. 5.7 한 트랜잭션: 질문 소유·현재 질문 확인 → `Answer` 저장 → (VOICE) S3 존재 확인 후 `Recording.answerAudio` 저장
4. 커밋 후 답변 채점 작업(SCORE_ANSWER)을 큐에 넣고, 다음 질문은 플랜에서 꺼내 저장한다([AI 명세](AI-명세.md) 2·3장). `isLastQuestion`은 5번 질문이면 true **[결정]**

### 5.3-1 면접관 리액션 (5.11)
- AI 실시간 반응 서비스가 처리하며 BE는 관여하지 않는다 **[결정]**. 처리 내용은 [AI 명세](AI-명세.md) 6장

### 5.4 끝내기 · 결과 생성 (5.8, 5.9, 6.1, 6.2)
1. 5.8 한 트랜잭션: `end()` → true면 `PracticeLog`를 그날(한국 시간, `ended_at` 기준) 처음일 때만 저장
   - 응답의 `leveledUp`: 이번에 `PracticeLog`가 새로 저장됐고, 저장 후 `currentStreak`의 뱃지 구간이 저장 전과 다르면 true(6.1). 저장되지 않았으면(같은 날 두 번째 면접, 답변 0개) false
   - 동시 요청 대비: `INSERT … ON CONFLICT (user_id, practice_date) DO NOTHING`으로 넣는다 **[제안]**. 제약 위반 예외를 잡고 계속 진행하면 PostgreSQL에서는 트랜잭션 전체가 실패한다
2. 결과 생성은 **비동기**: `analysisStep`을 `ORGANIZING_ANSWERS → SCORING → WRITING_FEEDBACK`으로 Redis에 갱신한다. 화면은 5.2를 2초마다(임시 값, B-11) 불러 확인한다
   - 채점·결과 저장은 AI 분석 작업자가 한다. BE는 작업 큐에 넣기만 한다([AI 명세](AI-명세.md) 3·4장) **[결정]**
     - 채점 대상: 기준 4개(직무 적합성 · 자소서 검증 · 논리성 · 전달력)
     - 판단 근거: 인재상 부합 · 사업·직무 연결 · 질문 의도 · 구체성을 종합
     - 전달력: 화상은 답변 + 말하기 지표(비어 있으면 빼고), 채팅은 답변 글로 판단
     - 3단계는 BE가 점수로 계산(경계 API 명세 6.3)
   - 자소서 검증도 다른 기준과 같이 3단계로 판정하고, 자소서 대조로 확정한다 **[결정]**
3. 6.2 녹화 등록 → 비동기로 영상에서 시선 응시 비율 계산 → `SpeechMetric.recordGazeRatio()`. 녹화가 없으면 null **[결정]**

## 6. 계산 규칙 (저장하지 않음)

### 6.1 연습 면접 · 스트릭 **[결정]**
- 연습 면접 = 답변 1개 이상으로 끝난 면접(`ANALYZING`·`COMPLETED`·`FAILED`). 면접 수·연습 시간은 모두 이 기준
- 연습한 날 = `practice_logs`에 있는 날
- `currentStreak`: 오늘 기록이 있으면 오늘부터, 없으면 어제부터 거꾸로 빠짐없이 이어진 날 수. 어제도 없으면 0
- `bestStreak`: 전체 기록에서 가장 긴 연속 구간
- `homeState`: 기록 없음 → `FIRST_VISIT` / 오늘 기록 있음 → `DONE_TODAY` / 어제 기록 있음 → `NOT_DONE_TODAY` / 그 외 → `BROKEN`
- 스트릭은 연습 면접을 끝낸 순간(5.8에서 `PracticeLog` 저장) 오른다
- 뱃지 구간: 0 / 1–2 / 3–5 / 6–7 / 8–13 / 14+일 **[결정: Figma]**
- `leveledUp`(5.8 응답): 이번 끝내기로 스트릭이 올라 뱃지 구간이 바뀌었으면 true. 즉 그날 첫 연습 기록이 저장되고 `currentStreak`가 1·3·6·8·14일이 된 경우(5.4). 면접 끝내기는 한 번만 호출되므로 레벨업도 한 번만 전달된다. 화면은 이 값을 기억해 뒀다가 S08에서 레벨업을 띄운다
- 연습 시간(분) = Σ(`ended_at − started_at`) / 60. 연결이 끊겨 멈춘 시간은 포함된다(멈춘 시간은 Redis에만 있어 종료 후 사라짐) **[제안: 필요하면 종료 시 저장 방법 협의]**

### 6.2 성장 리뷰 (7.1, 7.2, 3.1) **[결정]**
- 성장 리뷰는 별도 테이블 없이 `session_scores`·`answers`로 계산한다
- 그날 점수 = 그날 `COMPLETED` 면접들의 `session_scores.score` 기준별 평균(반올림 정수 **[제안]**)
- 비교 대상 = 그날 이전 가장 최근 연습일. `delta` = 그날 − 비교 대상(첫 연습일 null)
- 다음에 해볼 것 = 그날 `session_scores`(`comment`)와 `answers`(`improve_point`) 중 최저 점수의 문구. 문구가 비면 다음으로 낮은 것. 동점이면 모두
- `criteria[].comment` = 그날 마지막 면접의 `comment`
- 7.2 / 3.1 `recentReviews`의 `criterion·delta` = 그날 가장 많이 오른 기준
- 3.1 `todayImprovements` = 오늘 `delta > 0`인 기준, 큰 순

### 6.3 기타
- `inUse` = 그 지원서를 쓴 `interview_sessions`가 있는지
- `latestJobTitle` = 가장 최근 면접에 쓴 지원서의 직무
- `grade` = `Grade.of(score)`. 경계는 API 명세 6.3 **[결정]**
- `elapsedSeconds` = (`ended_at` 또는 지금) − `started_at` − 멈춘 시간(Redis). `SessionRuntime.elapsedSeconds()`

### 6.4 연습 면접 목록 (5.13)

- 로그인한 회원의 세션 중 답변이 1개 이상이고 `ANALYZING`·`COMPLETED`·`FAILED`인 세션을 조회한다. 날짜는 한국 시간 `started_at` 기준이며 날짜 시작 이상·다음 날 시작 미만 범위를 사용한다. 스트릭은 기존 종료일 기준을 유지하고, 연습 기록 달력은 3.3의 `dateBasis=STARTED_AT`으로 조회한다
- 세션을 `started_at DESC, id DESC`로 먼저 페이징하고, 해당 페이지의 답변 수·기준별 등급을 일괄 조회한다. 기본 크기는 5(허용 1~20)다. 점수 4개를 join한 행에 직접 페이징하면 세션 중복과 잘못된 전체 건수가 생기므로 피한다
- 회사·직무는 해당 세션이 참조한 지원서, 총평은 `interview_sessions.summary`, 등급은 `session_scores`에서 읽는다. 새 평가를 생성하지 않는다. 분석 중·실패는 총평 null·등급 빈 배열이다
- 날짜별 전체 건수·시간 집계는 페이지 제한 없이 계산한다. 보관함 전체 건수는 날짜 필터를 적용하지 않는다. 소유자·탈퇴 여부·연습 면접 조건은 목록과 집계에 동일하게 적용한다
- 시간은 선택 날짜 전체 세션의 `ended_at − started_at` 초 합 / 60 내림으로 계산한다. `elapsedSeconds`와 혼용하지 않는다

## 7. Redis 키 **[제안]**

| 키 | 값 | TTL | 쓰는 곳 |
|---|---|---|---|
| `refresh:{SHA-256(token)}` | userId | 리프레시 유효 기간(BE 결정) | 1.2~1.5. 재발급 시 삭제 후 새로 저장(회전) |
| `refresh-user:{userId}` | 그 회원의 `refresh:` 키 정렬 집합(점수: 만료 시각 epoch 초) | 마지막 발급 후 리프레시 유효 기간 | 발급 때 넣으며 만료 시각이 지난 키를 정리하고, 재발급·로그아웃 때 뺀다. 2.7 탈퇴 때 집합의 키를 모두 지운다 |
| `session:{sessionId}:runtime` | Hash. 필드 `planStatus`·`planProgress`·`analysisStep`(작업자도 씀)·`pausedSeconds`·`planStartedAt`(epoch 밀리초, BE만 씀). 값이 없으면 필드 없음. 각자 자기 필드만 `HSET`/`HDEL` **[결정]** | BE가 쓸 때마다 1일(결과 생성 시작 = 면접 종료 + 1일) | 5.x. `planStatus`가 없을 때 플랜 행이 있으면 READY(AI 명세 1.2), 없으면 FAILED **[제안]**(기록을 잃은 면접을 5.3으로 다시 만들 수 있게. `SessionRuntimeService`) |
| `ai:jobs` | List. AI 작업 메시지 JSON(AI 명세 1.3). BE `LPUSH`, 작업자 `BLMOVE`로 `ai:jobs:processing`에 옮겨 처리 **[결정]** | 없음 | 5.1·5.3·5.7·5.8·5.9 (5.0) |
| `upload:{objectKey}` | userId · 용도 | Presigned 만료와 같게 | 2.5·5.7·6.2에서 "본인에게 발급된 키"인지 확인 |
| `idem:{userId}:{Idempotency-Key}` | `IdempotencyRecord` JSON: 요청 지문(메서드·경로·본문 SHA-256) + 첫 성공 응답(상태·Content-Type·본문) | 처리 중 1분, 끝난 응답 24시간 **[결정]** | 5.1·5.4·5.7·5.8 (8장) |

ERD 메모의 "비밀번호 재설정 토큰"은 비밀번호 찾기가 MVP 제외라 지금은 쓰지 않는다.

## 8. 멱등성 **[결정]**

컨트롤러 메서드에 `@Idempotent`를 붙이면 `IdempotencyInterceptor`가 처리하고, Swagger에 필수 `Idempotency-Key` 헤더가 표시된다. `IdempotencyFilter`는 이 헤더가 있는 요청만 본문을 미리 읽고 응답을 모아 둔다.

1. 헤더가 없거나 UUID가 아니면 400 `VALIDATION_FAILED`(`errors[].field`: `Idempotency-Key`)
2. 요청 지문 = SHA-256(메서드 + 경로 + 본문). 같은 키를 다른 API에 쓰면 다른 요청으로 본다
3. 처리 전에 `idem:` 키를 `SET NX`로 잡는다(처리 중 표시, 1분). 서버가 처리 도중 멈춰도 1분 뒤 같은 키로 다시 시도할 수 있다
4. 이미 있고 지문이 같으며 처리가 끝났으면 저장한 첫 응답(상태·본문)을 그대로 돌려준다. 컨트롤러는 실행하지 않는다
5. 지문이 다르거나 아직 처리 중이면 409 `IDEMPOTENCY_KEY_REUSED`(처리 중도 같은 code. 화면은 같은 키로 잠시 뒤 다시 보내면 첫 응답을 받는다)
6. 2xx로 끝나면 응답을 24시간 저장한다. 4xx·5xx로 끝나면 처리 중 표시를 지워 같은 키로 다시 시도할 수 있게 한다(끝난 기록은 지우지 않음)

## 9. 인증

### 로그인·토큰 정책 **[결정]**

- 액세스 토큰: JWT(짧게), 리프레시 토큰: 불투명 값 + Redis(길게, 자동 로그인 유지)
- 재발급마다 리프레시 토큰을 새로 발급하고 이전 값은 폐기(회전). 폐기된 값으로 요청하면 401 `REFRESH_TOKEN_INVALID`
- 여러 기기 동시 로그인을 허용한다. 로그인마다 별도 리프레시 토큰을 발급하며 다른 기기의 토큰은 유지한다.
- 로그아웃은 인증한 회원이 요청에 제출한 리프레시 토큰만 폐기한다. 다른 기기의 토큰과 액세스 토큰은 유지한다. 이미 폐기된 토큰도 204로 응답한다.
- 재발급은 제출한 토큰만 소비·회전하며 다른 기기의 토큰에는 영향을 주지 않는다. Redis GETDEL로 같은 토큰의 동시 재사용을 막는다.
- 탈퇴(2.7)는 비밀번호를 확인하고 `deleted_at`을 기록한 뒤 `refresh-user:{userId}`로 모든 기기의 리프레시 토큰을 폐기한다. 이후 로그인·재발급·JWT 검증은 탈퇴 회원을 조회하지 않아 막힌다(액세스 토큰도 만료 전에 401).
- 토큰 폐기가 실패해도 탈퇴는 성공으로 둔다. 남은 토큰은 재발급에서 탈퇴 회원으로 거절된다. 이 집합이 생기기 전에 발급된 토큰도 같은 이유로 쓸 수 없다.
- 액세스 토큰의 `nickname` 클레임은 발급 시점 값이다. 닉네임 변경(2.2)은 새 액세스 토큰을 함께 주고 리프레시 토큰은 유지한다. 다른 기기의 토큰은 다음 재발급 때 바뀐 값이 된다.
- Redis 키에는 토큰 원문 대신 SHA-256 해시를 사용하고, 값에 회원 ID를 저장하고 키에 TTL을 설정한다.

## 10. 파일 (S3) **[제안]**

`storage.s3`(버킷·리전·주소 유효 시간)로 설정한다. 자격 증명은 AWS 기본 공급자(환경 변수 등)에서 읽어, 없으면 파일 주소가 필요한 요청만 실패한다. 업로드 주소 10분, 조회 주소 1시간.

| 용도 | 키 규칙 | 업로드 | 조회 |
|---|---|---|---|
| 프로필 사진 | `profile/{userId}/{uuid}.{ext}` | 2.4 Presigned PUT(JPG·PNG, 5MB) | 응답마다 Presigned GET |
| 답변 음성 | `sessions/{sessionId}/answers/{questionId}.{ext}` | 5.6 | 분석에서만 사용 |
| 면접 녹화 | `sessions/{sessionId}/session.{ext}` | 6.1(용량이 크면 멀티파트) | 6.4 Presigned GET |

- 업로드 주소(2.4)는 형식(Content-Type)과 크기를 서명에 넣는다. 발급 때와 다른 파일은 S3가 거절한다
- 업로드 주소를 발급하면 `upload:{objectKey}`(7장)에 회원 id와 용도를 남긴다. 등록 API는 본인에게 같은 용도로 발급된 키가 아니면 400 `VALIDATION_FAILED`(`objectKey`)
- 등록 API(2.5·5.7·6.2)는 S3에 실제 파일이 있는지 확인한다. 없으면 404 `FILE_NOT_FOUND`. 버킷 목록 권한(`s3:ListBucket`)이 없으면 S3가 없는 파일에도 403을 주므로 BE 권한에 포함한다
- 프로필 사진을 바꾸거나(2.5) 지우면(2.6) 회원 정보를 저장한 뒤 이전 파일을 지운다. 파일 삭제가 실패해도 요청은 성공으로 두고 경고 로그만 남긴다
- 탈퇴는 soft delete **[결정]**: 회원 행의 개인정보(이메일·닉네임·비밀번호 해시)와 프로필 사진·녹화·답변 음성 파일을 지우지 않는다
- 녹화 보관 기간, 탈퇴 회원 보관 데이터의 최종 파기 시점·방법 **[미정] B-6**

## 11. 오류 처리 **[결정]**
- 응답 형식: ProblemDetail + `code`(+ 400은 `errors`). `GlobalExceptionHandler`가 Spring 자체 오류에도 `code`를 붙인다
- 업무 오류: `throw new ApiException(ErrorCode.X)`. 필드 사이 검증 실패: `FieldValidationException(field, reason)`
- 상태 오류는 엔티티가 던진다(4장)

## 12. 남은 일
1. 인증 이외 기능의 Controller·Service·Repository 구현
2. 탈퇴 회원 보관 데이터의 최종 파기(B-6 결정 후)
3. 답변 음성·녹화 업로드(5.6·6.1)의 S3 연동, 면접 AI 모듈 어댑터
4. 후속 API의 인증 사용자 식별·리소스 소유권 검증
5. 시선 분석(6.2) 실행 주체와 방식(B-14). 플랜·채점·결과 생성은 Outbox + Redis 작업 큐로 결정(5.0)
