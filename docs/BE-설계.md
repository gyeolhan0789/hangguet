# A301 BE 설계

> API 계약은 목 서버(`mock/`)의 Swagger(`/docs`)와 [API 명세](API-명세.md)가 기준이다. Swagger는 API별 요청·응답을, 명세 문서는 공통 규약·업무 규칙·보류 목록을 담는다. 이 문서는 그 API를 **어떻게 구현하는지**를 적는다.
> 표기: **[결정]** 팀에서 정한 것 · **[제안]** 이 문서가 제안하는 것(확정 전) · **[미정]** 보류 목록([API 명세 4장](API-명세.md#4-보류--확인-필요-b) B-번호)

## 1. 범위 · 스택

| 항목 | 내용 |
|---|---|
| 런타임 | Java 21, Spring Boot 4.1.x |
| 저장소 | PostgreSQL 18.x(영구 데이터), Redis(진행 중 상태·토큰·멱등 키·AI 작업 큐·결과 큐) |
| 파일 | S3. DB에는 `object_key`만 저장 **[결정]** |
| 면접방 | LiveKit 서버 API(입장 토큰 서명, 에이전트 배정, 방 삭제, Egress 녹화). 서버 SDK는 **[제안]**(LiveKit 공식 JVM SDK `io.livekit.server`) |
| AI 연동 | BE와 AI는 HTTP로 서로 부르지 않는다. Redis 작업 큐(`ai:jobs`)로 일을 넘기고 결과 큐(`ai:results`)로 돌려받는다. **DB는 BE만 다룬다** **[결정]**([AI 명세](AI-명세.md) 1장) |
| 스키마 | Flyway `backend/src/main/resources/db/migration`. JPA는 `ddl-auto: validate`로 엔티티와 DDL이 어긋나면 기동 실패 |
| 시간 | 저장은 `timestamptz`, 응답은 `+09:00`. "날짜"(연습일)는 한국 시간 면접 시작일 기준 **[결정]** |

- DB에서 읽은 일시는 UTC 오프셋으로 나온다(같은 시각). 응답의 `+09:00`은 Jackson 설정 `spring.jackson.time-zone: Asia/Seoul`이 맡는다(목 서버와 같음)

## 2. 폴더 · 패키지 구조

| 폴더 | 역할 |
|---|---|
| `mock/` | API별 요청·응답(Swagger)과 예시 응답. 실제 로직·DB 없음. FE가 실제 백엔드 완성 전에 붙여 개발 |
| `backend/` | 실제 백엔드. DB 스키마·도메인·DTO·Mapper와 API 구현(구현 현황은 아래) |

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
│  ├─ service      InterviewSessionService(5.1~5.5·5.8·5.9), AnswerService(5.7 채팅),
│  │               AiJobService·AiJobPublisher(Outbox), SessionRuntimeService,
│  │               AiJobMessages(작업 메시지), AiResultConsumer·AiResultService(결과 큐 처리),
│  │               InterviewRoomService(면접방, 예정)
│  ├─ dto          InterviewDtos
│  ├─ mapper       InterviewMapper
│  ├─ repository   InterviewSessionRepository, InterviewQuestionRepository, InterviewPlanRepository,
│  │               AiJobRepository, AiJobQueue·RedisAiJobQueue, AiResultQueue·RedisAiResultQueue,
│  │               SessionRuntimeStore·RedisSessionRuntimeStore
│  ├─ livekit      LiveKit 서버 API 어댑터(입장 토큰·배정·방 삭제·Egress, 예정)
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
- 현재 인증 Controller·Service, 회원 정보·프로필·탈퇴(2.1~2.7)·지원서(4.1~4.5) Controller·Service, 면접 만들기~지금 질문·채팅 답변·끝내기·결과 재생성(5.1~5.5·5.7~5.9) Controller·Service, 회원·지원서·연습 기록 Repository, JWT Security, Redis 토큰·업로드 키 저장소, S3 파일 어댑터, 면접 플랜 조회 Repository, 멱등성 처리(8장), AI 작업 Outbox·큐 전송과 진행 상태 저장소(5장 5.0·7장)와 공통 오류 처리·Swagger가 구현되어 있다. 다른 기능의 Controller·Service·Repository는 후속 구현 대상이다.
- 트리에서 「예정」으로 표시한 클래스·패키지는 아직 없는 것으로, 이름과 나눔은 **[제안]**이다

- 변환 규칙: **엔티티 → 응답 DTO는 `*Mapper`의 정적 메서드**로만 한다. 계산값(스트릭, `inUse`, 임시 주소 등)은 서비스가 구해서 Mapper 인자로 넘긴다. 엔티티를 응답으로 그대로 내보내지 않는다 **[제안]**
- enum: DB에 저장하는 값과 API 값이 같은 enum은 `domain`에 하나만 두고 DTO도 그것을 쓴다

## 3. 도메인 모델 (엔티티 ↔ ERD)

가입은 필수 약관 3개(`TERMS`·`PRIVACY`·`RECORDING`)와 화면에 표시한 버전을 모두 저장한다. 하나라도 빠지면 400 `AGREEMENT_REQUIRED`.

| 엔티티 | 테이블 | 연관 | 비고 |
|---|---|---|---|
| `User` | `users` | - | 탈퇴는 soft delete: `deleted_at`만 기록하고 행·관련 데이터·파일은 남긴 채 조회에서 제외. 이메일은 **탈퇴하지 않은 회원끼리만** 중복 불가(부분 UNIQUE 인덱스) **[결정]** |
| `UserAgreement` | `user_agreements` | N:1 User | 가입 시 TERMS·PRIVACY·RECORDING 3개 모두 기록 **[결정]** |
| `Application` | `applications` | N:1 User | 저장해 두고 재사용. 면접에 쓴 지원서는 수정·삭제 불가(409 `APPLICATION_IN_USE`) **[결정]**. 삭제는 실제 삭제 |
| `InterviewSession` | `interview_sessions` | N:1 User, N:1 Application | 상태 전이는 엔티티 메서드로만(4장) |
| `InterviewQuestion` | `interview_questions` | N:1 Session | **질문을 낸 시점에 행 생성** **[결정]**. 낸 시점 = AI 에이전트가 그 질문을 말하기 시작한 때(결과 메시지 `question.started`의 `startedAt`을 `created_at`으로, 엔티티가 직접 정함) **[결정]**. `(session_id, seq)` UNIQUE |
| `AiJob` | `ai_job_outbox` | - | AI 작업 Outbox(5.0). id = 메시지의 `jobId`(UUID). 보낸 기록 로그라 면접·답변에 외래키 없음. 큐에 보내면 `published_at` |
| `InterviewPlan` | `interview_plans` | 1:1 Session(PK 공유) | 질문 5개·질문별 채점 기준·주장(JSONB)·버전. BE가 결과 메시지 `plan.completed`를 받아 면접당 한 번 저장하고 바꾸지 않는다(`claims`는 `PlanClaim`, 질문은 `PlanQuestion`) |
| `Answer` | `answers` | 1:1 Question | `question_id` UNIQUE. 점수·피드백은 결과 생성 때 채움. `tokens`(JSONB, 화상 확정 토큰)·`speech`(JSONB, 말끝 흐림·억양 폭)·`started_at`(듣기 시작한 시각, `answerStartedAt`)은 `answer.completed`로 받아 저장(V4 마이그레이션). `evaluation`(JSONB, 채점 판정)은 `answer.scored`(비어 있을 때만)·`evaluation.completed`(확정본)로 받아 저장한다. 덮어쓰기 규칙은 [AI 명세](AI-명세.md) 1.4 |
| `Recording` | `recordings` | N:1 Session, N:1 Answer(null 가능) | 화상만. Egress 원본 트랙(BE가 녹화를 시작할 때 위치를 정함)과 합친 mp4(`SESSION_VIDEO`, `recording.merged`로 받음). 위치는 원본 `recordings/raw/{sessionId}/`, 합친 mp4 `recordings/{sessionId}.mp4`(`Recording.rawPrefix`·`sessionVideoKey`, AI 명세 7장). 원본 트랙을 행으로 남길지 **[제안]**, 답변별 음성 **[미정]**(API 명세 B-19). `object_key` UNIQUE |
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

허용되지 않는 전이는 엔티티가 409 `INVALID_SESSION_STATE`를 던진다. 결과 생성 완료·실패 전이는 API가 아니라 결과 큐 처리(5.5)가 부르며, 이때 허용되지 않는 전이(이미 `COMPLETED` 등)는 오류 대신 그 메시지를 버린다.

## 5. 처리 흐름

### 5.0 AI 작업 전송 (Outbox) **[결정]**
1. 업무 트랜잭션 안에서 `AiJobService.enqueue(AiJob.plan/scoreAnswer/evaluate(...))`로 `ai_job_outbox`에 넣는다. 트랜잭션 밖에서 부르면 예외(업무가 롤백되면 작업도 남지 않음)
2. 커밋 직후 `AiJobPublisher`가 Redis `ai:jobs`에 `LPUSH`하고 `published_at`을 남긴다. 실패해도 업무 응답은 성공이다
3. 보내지 못한 작업은 5초(`ai-job.republish-interval`)마다 다시 보낸다. 행을 `FOR UPDATE SKIP LOCKED`로 잡아 같은 작업을 동시에 두 번 보내지 않는다
4. 큐에 넣은 뒤 기록에 실패하면 같은 작업이 한 번 더 갈 수 있다. AI는 같은 작업을 두 번 처리해도 되고, 중복 결과는 BE가 결과 큐 처리에서 거른다([AI 명세](AI-명세.md) 1.4)
5. 작업자는 `BLMOVE ai:jobs ai:jobs:processing`으로 꺼내고 끝나면 처리 중 리스트에서 지운다(AI 쪽 구현)
6. **메시지에 작업 내용을 담는다**. AI가 DB를 읽지 않으므로 작업 메시지에 자소서·질문·답변 등 필요한 내용을 담는다(형식은 AI 명세 1.3·2~4·7장). Outbox 행은 id만 남기고, `AiJobPublisher`가 보낼 때 `AiJobMessages`로 DB에서 읽어 메시지를 만든다. `requestedAt`은 Outbox 행을 만든 시각(한국 시간)이며 AI도 최대 대기 시간을 여기부터 센다. 화상 답변은 `tokens`·`speech`를 함께 보낸다. 면접·플랜·답변이 없어 만들 수 없는 작업은 다른 작업을 막지 않도록 보낸 것으로 두고 오류 로그를 남긴다. 답변 음성 위치는 B-19가 정해지면 더한다. 녹화 합치기(`MERGE_RECORDING`)는 `rawPrefix`·`objectKey`를 담는다(화상만)

### 5.1 면접 만들기 → 플랜 생성 (5.1, 5.3)
1. 지원서 소유 확인(지원서 행 잠금, 3장) → `InterviewSession`(READY) 저장 → Redis `startPlan`(planStatus GENERATING, planProgress 0) → PLAN 작업 enqueue(5.0). Redis 쓰기는 커밋 전(트랜잭션 안)에 한다. 커밋 뒤에 쓰면 결과(`plan.completed`)가 먼저 처리될 때 GENERATING이 아니라며 버릴 수 있다. 5.3도 같다
2. 플랜 생성은 **비동기**(AI 분석 작업자). BE가 결과 메시지 `plan.progress`를 받아 Redis `planProgress`를 갱신한다. 화면은 5.2를 2초마다(임시 값, B-11) 불러 확인한다
   - 최대 대기 3분(`ai-job.plan-timeout`, B-11 임시 값) **[제안]**: 시작 시각(`planStartedAt`)부터 3분이 지나도 GENERATING이면 5.2 조회 때 FAILED로 바꾼다(AI 명세 5장). 아직 GENERATING일 때만 바꾸고(Lua), 그 사이 플랜 행이 저장됐으면 READY로 본다
3. `plan.completed` → `interview_plans` 저장, Redis `planStatus=READY` / `plan.failed` → `FAILED`(5.5). GENERATING인데 플랜 행이 이미 있으면(저장 뒤 READY를 남기지 못하고 다시 처리) 새로 저장하지 않고 READY만 남긴다
4. 플랜(질문 5개·질문별 채점 기준)은 `interview_plans`에 저장한다(V2 마이그레이션, 형식은 AI 명세 2장). `interview_questions`에는 질문을 낼 때 넣는다 **[결정]**(5.2)

### 5.2 면접 시작 · 질문 출제 (5.4, 5.5, 5.14)
1. 5.4 한 트랜잭션(면접 행 잠금): `start(now)` → 면접방 열기(5.6) → 입장 토큰을 응답 `room`에 담는다
   - 방을 만들고(화상이면 트랙 자동 녹화를 켬) AI 에이전트를 배정한다. 배정 정보에 `interview_plans`의 질문 5개·채점 기준과 `currentSeq` 1을 담는다(AI 명세 6.1)
   - 질문 행은 만들지 않는다. 응답 `currentQuestion`은 null **[결정]**(API 명세 B-16)
   - 방 만들기·배정이 실패하면 만든 방을 지우고 503 `ROOM_UNAVAILABLE`, 트랜잭션은 롤백해 `READY`로 둔다 **[결정]**(B-17). 방을 연 뒤 커밋이 실패해도 방을 지운다(`TransactionSynchronization`)
   - 외부 호출을 행 잠금 안에서 하는 이유: 같은 면접을 두 번 시작해 방이 둘 생기지 않게 한다. 호출 시간 제한은 5초
2. 질문 행은 에이전트가 질문을 말하기 시작할 때 만든다: 결과 메시지 `question.started`(`seq`, `startedAt`) → `InterviewQuestion(seq, created_at = startedAt)` 저장. 같은 `(session_id, seq)`가 이미 있으면 버린다. 이 `created_at`이 다시보기 마커 기준이다 **[결정]**
3. 5.5는 답이 없는 마지막 질문 행을 준다. 아직 질문 행이 없으면(시작 직후 포함) 202 `QUESTION_GENERATING`("아직 내지 않음", B-16), 5개에 모두 답했으면 409 `INVALID_SESSION_STATE`
4. 5.14는 `IN_PROGRESS`일 때 입장 토큰만 새로 만든다(재접속용)

### 5.3 답변 저장 (화상 `answer.completed`, 채팅 5.7)
1. **화상**: 결과 메시지 `answer.completed`(`seq`, `answerStartedAt`, `content`, `tokens`, `speech`, `endReason`)를 받아 한 트랜잭션에서 질문 행 확인 → `Answer` 저장(`content`·`tokens`·`speech`·`started_at`) → SCORE_ANSWER enqueue. `content` 1~10,000자, `tokens` 10,000개 이하·`0 ≤ startMs ≤ endMs`, `answerStartedAt` 필수이며 어기면 실패 목록으로 옮긴다(5.5-6). 같은 질문에 답변이 이미 있으면(`answers.question_id` UNIQUE) 버린다. 면접이 `IN_PROGRESS`가 아니면 버린다(5.8과의 순서는 **[미정]**, API 명세 B-18)
2. **채팅**: 5.7 한 트랜잭션에서 질문 소유·현재 질문 확인 → `Answer` 저장 → SCORE_ANSWER enqueue. 다음 질문으로 넘어가는 신호는 화면이 에이전트에 보낸다(API 명세 면접방 메시지) **[제안]**
3. 답변 음성 파일을 따로 받지 않는다. 채점용 답변별 음성은 **[미정]**(API 명세 B-19)

### 5.3-1 면접관 리액션
- AI 에이전트가 면접방 메시지로 처리하며 BE는 관여하지 않는다 **[결정]**. 처리 내용은 [AI 명세](AI-명세.md) 6장

### 5.4 끝내기 · 결과 생성 (5.8, 5.9)
1. 5.8 한 트랜잭션: `end()` → true면 `PracticeLog`를 해당 시작일(한국 시간, `started_at` 기준) 처음일 때만 저장
   - 응답의 `leveledUp`: 이번에 `PracticeLog`가 새로 저장됐고, 저장 후 `currentStreak`의 뱃지 구간이 저장 전과 다르면 true(6.1). 저장되지 않았으면(같은 날 두 번째 면접, 답변 0개) false
   - 동시 요청 대비: `INSERT … ON CONFLICT (user_id, practice_date) DO NOTHING`으로 넣는다(`PracticeLogRepository.insertIfAbsent`). 제약 위반 예외를 잡고 계속 진행하면 PostgreSQL에서는 트랜잭션 전체가 실패한다
   - 답변 ≥1이면 EVALUATE enqueue → Redis `startAnalysis`(analysisStep ORGANIZING_ANSWERS, 시작 시각, 이번 EVALUATE `jobId`). 5.9도 같다. 화상이면 MERGE_RECORDING도 enqueue한다(5.9에서는 다시 하지 않음)
   - 커밋 뒤 면접방을 삭제(에이전트 퇴장)하고, 화상이면 Egress 녹화를 멈춘다(5.6)
   - 화상 마지막 답변이 아직 결과 큐에 남아 있을 때의 순서는 **[미정]**(API 명세 B-18)
2. 결과 생성은 **비동기**: BE가 결과 메시지 `evaluation.progress`를 받아 `analysisStep`을 `ORGANIZING_ANSWERS → SCORING → WRITING_FEEDBACK`으로 Redis에 갱신한다. 화면은 5.2를 2초마다(임시 값, B-11) 불러 확인한다
   - 최대 대기 10분(`ai-job.analysis-timeout`, B-11 임시 값) **[제안]**: 시작 시각(`analysisStartedAt`)부터 10분이 지나도 ANALYZING이면 5.2 조회 때 면접 행을 잠그고 FAILED로 바꾼다(AI 명세 5장). 그 사이 결과가 저장돼 COMPLETED가 됐으면 그대로 둔다
   - 채점·피드백 계산은 AI 분석 작업자가 하고, 저장은 BE가 `evaluation.completed`를 받아 한다([AI 명세](AI-명세.md) 3·4장) **[결정]**
     - 채점 대상: 기준 4개(직무 적합성 · 자소서 검증 · 논리성 · 전달력)
     - 판단 근거: 인재상 부합 · 사업·직무 연결 · 질문 의도 · 구체성을 종합
     - 전달력: 화상은 답변 + 말하기 지표(비어 있으면 빼고), 채팅은 답변 글로 판단
     - 3단계는 BE가 점수로 계산(경계 API 명세 6.3)
   - 자소서 검증도 다른 기준과 같이 3단계로 판정하고, 자소서 대조로 확정한다 **[결정]**
3. 시선 응시 비율(`SpeechMetric.recordGazeRatio()`)은 녹화 영상에서 구한다. 계산 주체·시점 **[미정]**(API 명세 B-14). 녹화가 없으면 null

### 5.5 결과 큐 처리 (`ai:results`)
1. `AiResultConsumer`가 `BLMOVE ai:results ai:results:processing RIGHT LEFT`로 메시지를 꺼낸다
2. 메시지 하나를 한 트랜잭션으로 저장하고, 커밋 뒤 처리 중 리스트에서 지운다(`LREM`). 저장 중 BE가 멈춰도 메시지가 처리 중 리스트에 남아 다시 처리할 수 있다
3. `type`별 처리와 버림 조건은 [AI 명세](AI-명세.md) 1.4 표를 따른다. 버리는 메시지도 처리 중 리스트에서 지운다
4. 같은 메시지가 두 번 와도 결과가 같아야 한다: 유일 제약(`answers.question_id`, `uk_interview_questions_session_seq`, `interview_plans` PK)과 상태 조건(`planStatus`·`status`)으로 거른다
5. 5.9 재생성 뒤 이전 EVALUATE 결과가 늦게 오면 거른다: 세션별로 마지막으로 보낸 EVALUATE `jobId`를 Redis 진행 상태(`evaluateJobId`)에 두고 다른 `jobId`의 `evaluation.*`는 버린다. 기록이 없으면(만료) `ANALYZING` 조건만으로 거른다
6. 실패 처리 **[결정]**: DB·Redis 연결 장애, 시간 초과, 잠금 대기처럼 잠시 뒤 될 수 있는 실패만 처리 중 리스트에 두고 5초(`ai-result.retry-delay`)마다 같은 메시지를 다시 처리한다(순서 유지, 장애 동안 메시지를 잃지 않도록 횟수 제한 없음). 그 밖의 실패(JSON이 아님, 모르는 `type`, 필수 필드 없음, 질문 수 틀림, 질문 글·채점 기준 빈 값, DB 제약 위반, 예상하지 못한 오류)는 다시 해도 같으므로 `ai:results:failed`로 옮기고 경고 로그를 남긴다. 처리기가 하나라 한 메시지가 뒤의 모든 결과를 막지 않게 하기 위해서다
7. 처리기는 BE 하나에 스레드 하나로 순서대로 처리한다. 기동하면 처리 중 리스트에 남은 메시지(지난번에 처리 도중 멈춘 것)부터 처리한다
8. 받는 결과: `plan.*`·`question.started`·`answer.completed`·`answer.scored`·`evaluation.*`·`recording.*`
9. `evaluation.completed`(AI 명세 4장): 면접 행을 잠그고 `ANALYZING`·마지막 `jobId`일 때만 한 트랜잭션에서 답변 점수·피드백·`evaluation`(확정본으로 덮어씀)을 쓰고, `session_scores`·`speech_metrics`를 지우고 다시 쓴 뒤 `COMPLETED`·`summary`로 바꾼다. 커밋 뒤 `analysisStep`을 지운다
   - 실패 목록으로 옮기는 경우: 이 면접의 답변마다 결과가 하나씩이 아님, 기준 4개가 하나씩이 아님, 점수 0~100 밖, 총평·코멘트 255자 초과, 말하기 지표 ±999.99 밖(소수 둘째 자리로 반올림해 저장)
   - 채팅이거나 `speechMetrics`가 null이면 `speech_metrics` 행을 만들지 않는다
10. `evaluation.failed`: 같은 조건에서 `FAILED`, `analysisStep` 지움. `evaluation.progress`: 같은 조건에서 `analysisStep`만 갱신
11. `recording.merged`: `objectKey`가 그 면접의 `recordings/{sessionId}.mp4`가 아니면 실패 목록. 화상 면접이고 같은 위치 행이 없을 때만 `SESSION_VIDEO`로 저장(면접 상태와 무관). `recording.mergeFailed`는 다시보기 처리(B-19)가 정해질 때까지 경고 로그만 남긴다

### 5.6 면접방 (LiveKit)
- 구현: `InterviewRoom`(`LiveKitInterviewRoom`), 서버 SDK `io.livekit:livekit-server` 0.16.0(운영 서버 v1.13.10보다 먼저 나온 버전). 설정은 `livekit.*`, 주소·키·시크릿은 환경 변수 `LIVEKIT_URL`(서버 API용)·`LIVEKIT_PUBLIC_URL`(브라우저에 알려 줄 주소, 없으면 `LIVEKIT_URL`)·`LIVEKIT_API_KEY`·`LIVEKIT_API_SECRET`(배포 계획 7장과 같은 이름). 값이 없으면 5.4·5.14가 503 `ROOM_UNAVAILABLE`
- 입장 토큰(5.4·5.14): 방 `interview-{sessionId}` 하나, 참가자 이름 `candidate`. 화상은 마이크·카메라 송출·수신·메시지, 채팅은 수신·메시지만. 유효 시간 10분(`livekit.token-ttl`) **[결정]**(API 명세 B-20). LiveKit API 키·시크릿으로 서명(외부 호출 없음)
- 방 만들기: `RoomService.CreateRoom`. 빈 방은 10분 뒤 닫힌다(`empty_timeout`·`departure_timeout`)
- 에이전트 배정: `AgentDispatchService.CreateDispatch`(에이전트 이름 `a301-interviewer`·방 이름·배정 정보, AI 명세 6.1)
- 면접 종료(5.8 커밋 뒤): `RoomService.DeleteRoom`. 에이전트가 나가고 녹화도 끝난다. 실패해도 5.8은 성공으로 두고 로그만 남긴다
- 녹화(화상만): 방을 만들 때 트랙 자동 녹화(`RoomEgress.tracks`)를 켠다 **[결정]**. 방을 만들 때는 아직 트랙이 없어 트랙마다 녹화를 시작할 수 없기 때문이다. 파일 경로 설정은 `recordings/raw/{sessionId}/{publisher_identity}-{track_type}`이다. LiveKit 서버(v1.13.10 `getFilePath`)가 경로에 `{track_id}`가 없으면 `-{track_id}`를 붙이고, Egress가 코덱에 맞춰 확장자를 붙인다. 그래서 실제 파일은 `candidate-video-TR_…mp4`·`candidate-audio-TR_…ogg`·`interviewer-audio-TR_…ogg`이고, 재접속으로 트랙을 다시 올리면 같은 종류 파일이 하나 더 생긴다(덮어쓰지 않음). 합치기 작업은 `rawPrefix` 아래 파일을 이름 앞부분으로 찾는다 **[결정]**(AI 명세 7장). 에이전트는 참가자 이름 `interviewer`로 들어온다(AI 명세 6.1)
  - `{track_type}`은 `video`·`audio`(소문자, Egress `track_worker.go`)
  - S3 키는 `LIVEKIT_EGRESS_S3_ACCESS_KEY`·`LIVEKIT_EGRESS_S3_SECRET`(버킷·리전은 `S3_BUCKET`·`AWS_REGION`)로 요청에 담는다. LiveKit Cloud(개발)는 저장소가 없으면 방 만들기를 400 `egress request missing output`으로 거절한다(확인함). 키가 없으면 Egress 서버 설정의 저장소를 쓴다(셀프 호스팅, 운영 배포 계획 6.2)
- LiveKit 웹훅은 쓰지 않는다 **[제안]**(팀원 안 「Egress 종료 웹훅으로 녹화 등록」과 다름). 원본 위치는 BE가 녹화를 시작할 때 정하므로 종료 알림 없이도 합치기 작업에 넣을 수 있다

## 6. 계산 규칙 (저장하지 않음)

### 6.1 연습 면접 · 스트릭 **[결정]**
- 연습 면접 = 답변 1개 이상으로 끝난 면접(`ANALYZING`·`COMPLETED`·`FAILED`). 면접 수·연습 시간은 모두 이 기준
- 연습한 날 = `practice_logs`에 있는 한국 시간 면접 시작 날짜. 답변 1개 이상으로 종료한 뒤 기록하며, 자정·월 경계를 넘어도 시작일에만 기록한다.
- `currentStreak`: 오늘 기록이 있으면 오늘부터, 없으면 어제부터 거꾸로 빠짐없이 이어진 날 수. 어제도 없으면 0
- `bestStreak`: 전체 기록에서 가장 긴 연속 구간
- `homeState`: 기록 없음 → `FIRST_VISIT` / 오늘 기록 있음 → `DONE_TODAY` / 어제 기록 있음 → `NOT_DONE_TODAY` / 그 외 → `BROKEN`
- 스트릭은 연습 면접을 끝낸 순간(5.8에서 `PracticeLog` 저장) 오른다
- 뱃지 구간: 0 / 1–2 / 3–5 / 6–7 / 8–13 / 14+일 **[결정: Figma]**
- `leveledUp`(5.8 응답): 이번 끝내기로 시작일 기록이 추가되어 현재 스트릭의 뱃지 구간이 바뀌었으면 true. 비교 기준일은 종료 요청 시점의 한국 날짜(오늘)다. 즉 그날 첫 연습 기록이 저장되고 `currentStreak`가 1·3·6·8·14일이 된 경우(5.4). 면접 끝내기는 한 번만 호출되므로 레벨업도 한 번만 전달된다. 화면은 이 값을 기억해 뒀다가 S08에서 레벨업을 띄운다
- 홈·통계의 오늘/주/월 구분도 한국 시간 시작일 기준이다. 자정을 넘긴 세션은 전체 시간을 시작 날짜에 포함한다.
- 연습 시간(분) = Σ(`ended_at − started_at`) / 60. 연결이 끊겨 멈춘 시간은 포함된다(멈춘 시간은 Redis에만 있어 종료 후 사라짐) **[제안: 필요하면 종료 시 저장 방법 협의]**

### 6.2 성장 리뷰 (7.1, 7.2, 3.1) **[결정]**
- 성장 리뷰는 별도 테이블 없이 `session_scores`·`answers`로 계산한다
- 그날 = 한국 시간 `started_at` 날짜. 그날 점수 = 그날 시작한 `COMPLETED` 면접들의 `session_scores.score` 기준별 평균(반올림 정수 **[제안]**)
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

- 로그인한 회원의 세션 중 답변이 1개 이상이고 `ANALYZING`·`COMPLETED`·`FAILED`인 세션을 조회한다. 날짜는 한국 시간 `started_at` 기준이며 날짜 시작 이상·다음 날 시작 미만 범위를 사용한다. 스트릭도 같은 시작일 기준이며, 연습 기록 달력의 날짜별 횟수는 5.15로 조회한다
- 세션을 `started_at DESC, id DESC`로 먼저 페이징하고, 해당 페이지의 답변 수·기준별 등급을 일괄 조회한다. 기본 크기는 5(허용 1~20)다. 점수 4개를 join한 행에 직접 페이징하면 세션 중복과 잘못된 전체 건수가 생기므로 피한다
- 회사·직무는 해당 세션이 참조한 지원서, 총평은 `interview_sessions.summary`, 등급은 `session_scores`에서 읽는다. 새 평가를 생성하지 않는다. 분석 중·실패는 총평 null·등급 빈 배열이다
- 날짜별 전체 건수·시간 집계는 페이지 제한 없이 계산한다. 보관함 전체 건수는 날짜 필터를 적용하지 않는다. 소유자·탈퇴 여부·연습 면접 조건은 목록과 집계에 동일하게 적용한다
- 시간은 선택 날짜 전체 세션의 `ended_at − started_at` 초 합 / 60 내림으로 계산한다. `elapsedSeconds`와 혼용하지 않는다

### 6.5 월별 연습 면접 횟수 (5.15)

- `GET /interview-sessions/calendar?month=YYYY-MM`. 5.13과 같은 회원·탈퇴 여부·상태·답변 존재 조건을 사용한다. 한국 시간 시작일 기준으로 조회하며 월 시작 이상·다음 월 시작 미만 범위를 적용한다.
- DB에서 월 전체를 날짜별 `COUNT(*)`로 한 번 집계한다. 답변 존재 여부는 `EXISTS`로 검사해 답변 수만큼 면접이 중복 집계되지 않게 한다. 세션·답변 본문이나 평가를 가져오지 않는다.
- 서비스에서 월 1일~말일을 채우고 집계에 없는 날짜를 0회로 만든다. 응답은 `month`, `content[{ practiceDate, interviewCount }]`이며 페이지를 나누지 않는다. 기존 일별 목록과 스트릭 집계 계약은 유지한다.

## 7. Redis 키 **[제안]**

| 키 | 값 | TTL | 쓰는 곳 |
|---|---|---|---|
| `refresh:{SHA-256(token)}` | userId | 리프레시 유효 기간(BE 결정) | 1.2~1.5. 재발급 시 삭제 후 새로 저장(회전) |
| `refresh-user:{userId}` | 그 회원의 `refresh:` 키 정렬 집합(점수: 만료 시각 epoch 초) | 마지막 발급 후 리프레시 유효 기간 | 발급 때 넣으며 만료 시각이 지난 키를 정리하고, 재발급·로그아웃 때 뺀다. 2.7 탈퇴 때 집합의 키를 모두 지운다 |
| `session:{sessionId}:runtime` | Hash. 필드 `planStatus`·`planProgress`·`analysisStep`·`pausedSeconds`·`planStartedAt`·`analysisStartedAt`(epoch 밀리초). 값이 없으면 필드 없음. **BE만 쓴다** **[결정]**: `planProgress`·`analysisStep`은 결과 메시지(`plan.progress`·`evaluation.progress`)를 받아 쓴다. `evaluateJobId`는 마지막으로 보낸 EVALUATE `jobId`(5.5) | BE가 쓸 때마다 1일(결과 생성 시작 = 면접 종료 + 1일) | 5.x. `planStatus`가 없을 때 플랜 행이 있으면 READY(AI 명세 1.2), 없으면 FAILED **[제안]**(기록을 잃은 면접을 5.3으로 다시 만들 수 있게. `SessionRuntimeService`) |
| `ai:jobs` | List. AI 작업 메시지 JSON(AI 명세 1.3). BE `LPUSH`, 작업자 `BLMOVE`로 `ai:jobs:processing`에 옮겨 처리 **[결정]** | 없음 | 5.1·5.3·답변 저장·5.8·5.9 (5.0) |
| `ai:results` | List. AI 결과 메시지 JSON(AI 명세 1.4). AI `LPUSH`, BE `BLMOVE`로 `ai:results:processing`에 옮겨 처리 | 없음 | 5.5 |
| `ai:results:failed` | List. 다시 처리해도 저장할 수 없는 결과 메시지 원문 **[결정]** | 없음(확인 후 수동 정리) | 5.5 |
| `upload:{objectKey}` | userId · 용도 | Presigned 만료와 같게 | 2.5에서 "본인에게 발급된 키"인지 확인 |
| `idem:{userId}:{Idempotency-Key}` | `IdempotencyRecord` JSON: 요청 지문(메서드·경로·본문 SHA-256) + 첫 성공 응답(상태·Content-Type·본문) | 처리 중 1분, 끝난 응답 24시간 **[결정]** | 5.1·5.4·5.7·5.8 (8장) |

ERD 메모의 "비밀번호 재설정 토큰"은 비밀번호 찾기가 MVP 제외라 지금은 쓰지 않는다.

## 8. 멱등성 **[결정]**

컨트롤러 메서드에 `@Idempotent`를 붙이면 `IdempotencyInterceptor`가 처리하고, Swagger에 필수 `Idempotency-Key` 헤더가 표시된다. `IdempotencyFilter`는 이 헤더가 있는 요청만 본문을 미리 읽고 응답을 모아 둔다.

1. 헤더가 없거나 UUID가 아니면 400 `VALIDATION_FAILED`(`errors[].field`: `Idempotency-Key`)
2. 요청 지문 = SHA-256(메서드 + 경로 + 본문). 같은 키를 다른 API에 쓰면 다른 요청으로 본다
3. 처리 전에 `idem:` 키를 `SET NX`로 잡는다(처리 중 표시, 1분). 서버가 처리 도중 멈춰도 1분 뒤 같은 키로 다시 시도할 수 있다
4. 이미 있고 지문이 같으며 처리가 끝났으면 저장한 첫 응답(상태·본문)을 그대로 돌려준다. 컨트롤러는 실행하지 않는다
5. 지문이 다르면 바로 409 `IDEMPOTENCY_KEY_REUSED`. 같은 요청이 아직 처리 중이면 끝날 때까지 최대 10초(`idempotency.wait-timeout`) 기다린다: 성공했으면 그 응답을 돌려주고, 실패해 처리 중 표시가 지워졌으면 이번 요청이 처리한다. 그래도 끝나지 않으면 409 `IDEMPOTENCY_KEY_REUSED`. 화면은 이 409를 받으면 새 키를 쓰므로, 바로 409를 주면 같은 면접이 두 번 만들어질 수 있다
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
| 면접 녹화 원본 | `recordings/raw/{sessionId}/…`(트랙별 파일) | LiveKit Egress가 서버에서 바로 올림(화상만) | AI 분석 작업자가 합치기에 사용 |
| 면접 녹화 | `recordings/{sessionId}.mp4` | AI 분석 작업자가 합쳐 올림(`recording.merged`) | 6.4 Presigned GET |
| 답변 음성 | **[미정]**(트랙에서 잘라 쓸지 따로 저장할지, API 명세 B-19) | - | 분석에서만 사용 |

- 키 규칙은 [운영 배포 계획](../이해준/deploy_plan/README.md) 6.1을 따른다. Egress와 AI는 BE와 다른 IAM 키를 쓴다(같은 문서 6.2)
- 업로드 주소(2.4)는 형식(Content-Type)과 크기를 서명에 넣는다. 발급 때와 다른 파일은 S3가 거절한다
- 업로드 주소를 발급하면 `upload:{objectKey}`(7장)에 회원 id와 용도를 남긴다. 등록 API(2.5)는 본인에게 같은 용도로 발급된 키가 아니면 400 `VALIDATION_FAILED`(`objectKey`)
- 등록 API(2.5)는 S3에 실제 파일이 있는지 확인한다. 없으면 404 `FILE_NOT_FOUND`. 버킷 목록 권한(`s3:ListBucket`)이 없으면 S3가 없는 파일에도 403을 주므로 BE 권한에 포함한다
- 프로필 사진을 바꾸거나(2.5) 지우면(2.6) 회원 정보를 저장한 뒤 이전 파일을 지운다. 파일 삭제가 실패해도 요청은 성공으로 두고 경고 로그만 남긴다
- 탈퇴는 soft delete **[결정]**: 회원 행의 개인정보(이메일·닉네임·비밀번호 해시)와 프로필 사진·녹화·답변 음성 파일을 지우지 않는다
- 녹화 보관 기간, 탈퇴 회원 보관 데이터의 최종 파기 시점·방법 **[미정] B-6**

## 11. 오류 처리 **[결정]**
- 응답 형식: ProblemDetail + `code`(+ 400은 `errors`). `GlobalExceptionHandler`가 Spring 자체 오류에도 `code`를 붙인다
- 업무 오류: `throw new ApiException(ErrorCode.X)`. 필드 사이 검증 실패: `FieldValidationException(field, reason)`
- 상태 오류는 엔티티가 던진다(4장)

## 12. 남은 일
1. 남은 API(3.x, 6.x, 7.x)의 Controller·Service·Repository 구현
2. 면접방: 동시 면접 상한 거절(B-17), 에이전트가 끊겼을 때 다시 배정(AI 명세 6.5), 5.8 없이 떠난 면접의 방 정리
3. `recording.mergeFailed` 뒤 다시보기 처리(B-19 결정 후)
4. 탈퇴 회원 보관 데이터의 최종 파기(B-6 결정 후)
5. 시선 분석 실행 주체와 방식(B-14), 답변별 음성(B-19), 마지막 답변과 5.8 순서(B-18)
