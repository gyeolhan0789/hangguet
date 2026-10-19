# A301 BE 설계

> API 계약은 목 서버(`mock/`)의 Swagger(`/docs`)와 [API 명세](API-명세.md)가 기준이다. Swagger는 API별 요청·응답을, 명세 문서는 공통 규약·실시간(WebSocket) 계약·업무 규칙·보류 목록을 담는다. 이 문서는 그 API를 **어떻게 구현하는지**를 적는다.
> 표기: **[결정]** 팀에서 정한 것 · **[제안]** 이 문서가 제안하는 것(확정 전) · **[미정]** 보류 목록([API 명세 5장](API-명세.md#5-보류--확인-필요-b) B-번호)

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
| `backend/` | 실제 백엔드. 지금은 DB 스키마 · 엔티티 · DTO · 변환 · 오류 코드까지 |

두 폴더 모두 패키지는 `com.ssafy.a301`이고, 포맷·정적 분석 규칙이 같다. API를 `backend/`에 구현하면 그 API는 `backend/`의 Swagger가 기준이 되고, 모두 구현되면 `mock/`의 Controller·Swagger 설정을 `backend/`로 옮긴 뒤 `mock/`을 지운다 **[결정]**.

`backend/`는 기능(도메인)별로 나누고, 각 기능 안에 Controller · DTO · Mapper · `domain`(엔티티·enum)을 둔다.

```
com.ssafy.a301
├─ auth          1. 인증          AuthDtos
├─ user          2. 회원          UserDtos, UserMapper, domain/{User, UserAgreement, TermsType}
├─ home          3. 홈·스트릭     HomeDtos, HomeMapper, domain/PracticeLog
├─ application   4. 지원서        ApplicationDtos, ApplicationMapper, domain/Application
├─ interview     5. 면접 진행     InterviewDtos, InterviewMapper,
│                                 domain/{InterviewSession, InterviewQuestion, Answer, Recording, SessionScore, SpeechMetric,
│                                         SessionRuntime, enum 9종}
├─ result        6. 결과·다시보기 ResultDtos, ResultMapper
├─ growth        7. 성장 리뷰     GrowthDtos
└─ common/error  ErrorCode, ApiException
```

- 아직 없는 층: Controller, Service, Repository, Redis·S3·외부 API 어댑터, Security, WebSocket, 공통 오류 처리(`GlobalExceptionHandler`, 지금은 `mock/`에만 있음)
- 변환 규칙: **엔티티 → 응답 DTO는 `*Mapper`의 정적 메서드**로만 한다. 계산값(스트릭, `inUse`, 임시 주소 등)은 서비스가 구해서 Mapper 인자로 넘긴다. 엔티티를 응답으로 그대로 내보내지 않는다 **[제안]**
- enum: DB에 저장하는 값과 API 값이 같은 enum은 `domain`에 하나만 두고 DTO도 그것을 쓴다. API에서 받는 값이 더 좁은 녹화 종류(`SESSION_VIDEO`만)는 DTO 전용 enum을 둔다

## 3. 도메인 모델 (엔티티 ↔ ERD)

| 엔티티 | 테이블 | 연관 | 비고 |
|---|---|---|---|
| `User` | `users` | - | 탈퇴는 `deleted_at` 기록(행 유지). 이메일은 **탈퇴하지 않은 회원끼리만** 중복 불가(부분 UNIQUE 인덱스) **[결정]** |
| `UserAgreement` | `user_agreements` | N:1 User | 가입 시 TERMS·PRIVACY·RECORDING 3개 모두 기록 **[결정]** |
| `Application` | `applications` | N:1 User | 저장해 두고 재사용. 면접에 쓴 지원서는 수정·삭제 불가(409 `APPLICATION_IN_USE`) **[결정]**. 삭제는 실제 삭제 |
| `InterviewSession` | `interview_sessions` | N:1 User, N:1 Application | 상태 전이는 엔티티 메서드로만(4장) |
| `InterviewQuestion` | `interview_questions` | N:1 Session | **질문을 화면에 낸 시점에 행 생성** **[결정]**. `(session_id, seq)` UNIQUE **[제안]** |
| `Answer` | `answers` | 1:1 Question | `question_id` UNIQUE. 점수·피드백은 결과 생성 때 채움 |
| `Recording` | `recordings` | N:1 Session, N:1 Answer(null 가능) | `ANSWER_AUDIO`(5.7, answer 연결) · `SESSION_VIDEO`(6.2, 면접당 1개는 서비스에서 확인). `object_key` UNIQUE |
| `SessionScore` | `session_scores` | N:1 Session | `(session_id, criterion)` UNIQUE. 기준 4개 |
| `SpeechMetric` | `speech_metrics` | 1:1 Session(PK 공유) | 화상만. `gaze_ratio`는 녹화 영상에서, 나머지는 답변 음성에서 |
| `PracticeLog` | `practice_logs` | N:1 User | **연습한 날** 기록(스트릭·달력용). `(user_id, practice_date)` UNIQUE라 날짜당 한 건. 면접은 하루에 여러 번 볼 수 있고 그 기록은 `interview_sessions`에 면접마다 남는다 |

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

### 5.1 면접 만들기 → 플랜 생성 (5.1, 5.3)
1. 지원서 소유 확인 → `InterviewSession`(READY) 저장 → Redis `SessionRuntime.generating()`
2. 플랜 생성은 **비동기**(면접 AI 모듈 호출). 진행률을 Redis에 갱신하고 WebSocket `SESSION_STATUS_CHANGED`(planProgress)
3. 완료 → Redis `planStatus=READY` + `PLAN_READY` / 실패 → `FAILED` + `PLAN_FAILED`
4. 플랜(예상 질문·평가 기준) 저장 위치는 **[미정] B-9**. `interview_questions`에는 넣지 않는다

### 5.2 질문 출제 (5.4, 5.7 이후)
- 다음 질문이 정해지는 순간 `InterviewQuestion(seq = 이전 + 1)`을 저장하고 `QUESTION_READY`를 보낸다. 이 `created_at`이 다시보기 마커 기준이다 **[결정]**
- 질문 음성(TTS) 전달은 **[미정] B-1**

### 5.3 답변 제출 (5.6, 5.7, 5.10)
1. 화상: 5.10으로 STT 1회용 토큰 발급(회사 API 키는 서버에만) → 브라우저가 직접 스트리밍 **[결정]**. STT 회사 **[미정] B-2**
2. 5.6으로 답변 음성 업로드 주소 발급 → 브라우저가 S3에 PUT
3. 5.7 한 트랜잭션: 질문 소유·현재 질문 확인 → `Answer` 저장 → (VOICE) S3 존재 확인 후 `Recording.answerAudio` 저장
4. 커밋 후 비동기로 다음 질문 생성(5.2). `isLastQuestion`은 전체 질문 수와 비교 **[미정] B-3**

### 5.4 끝내기 · 결과 생성 (5.8, 5.9, 6.1, 6.2)
1. 5.8 한 트랜잭션: `end()` → true면 `PracticeLog`를 그날(한국 시간, `ended_at` 기준) 처음일 때만 저장
   - 응답의 `leveledUp`: 이번에 `PracticeLog`가 새로 저장됐고, 저장 후 `currentStreak`의 뱃지 구간이 저장 전과 다르면 true(6.1). 저장되지 않았으면(같은 날 두 번째 면접, 답변 0개) false
   - 동시 요청 대비: `INSERT … ON CONFLICT (user_id, practice_date) DO NOTHING`으로 넣는다 **[제안]**. 제약 위반 예외를 잡고 계속 진행하면 PostgreSQL에서는 트랜잭션 전체가 실패한다
2. 결과 생성은 **비동기**: `analysisStep`을 `ORGANIZING_ANSWERS → SCORING → WRITING_FEEDBACK`으로 Redis에 갱신하며 `SESSION_STATUS_CHANGED` 전송
   - 채점은 면접 AI 모듈이 한다 **[결정]**
     - 채점 대상: 기준 4개(직무 적합성 · 자소서 검증 · 논리성 · 전달력)
     - 판단 근거: 인재상 부합 · 사업·직무 연결 · 질문 의도 · 구체성을 종합
     - BE가 넘길 입력: 회사 카드 · 채용공고 · 지원서(자소서 포함) · 질문 · 답변, 화상이면 음성 지표(군말 · 긴 멈춤 · 말 속도 · 말끝 흐림 · 억양 · 시선)
     - 전달력: 화상은 답변 + 음성 지표, 채팅은 답변 글로 판단
     - 받을 출력: 기준별 0~100점 + 한 줄 설명, 질문별 점수 + 잘한 점 + 아쉬운 점. 3단계는 BE가 점수로 계산(B-4)
   - `Answer.evaluate()`, `SessionScore` 4개, `SpeechMetric`(화상) 저장 → `complete(summary)`
   - 자소서 검증 점수 = 100 − 명확한 충돌 수 × 차감 폭 **[결정]**, 차감 폭 **[미정] B-10**
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
- `grade` = `Grade.of(score)`. 경계 **[미정] B-4**(코드의 80/60은 임시값)
- `elapsedSeconds` = (`ended_at` 또는 지금) − `started_at` − 멈춘 시간(Redis). `SessionRuntime.elapsedSeconds()`

## 7. Redis 키 **[제안]**

| 키 | 값 | TTL | 쓰는 곳 |
|---|---|---|---|
| `refresh:{tokenId}` | userId | 리프레시 유효 기간(BE 결정) | 1.2~1.5. 재발급 시 삭제 후 새로 저장(회전) |
| `session:{sessionId}:runtime` | `SessionRuntime` JSON | 면접 종료 + 1일 | 5.x. planStatus·planProgress·analysisStep·pausedSeconds |
| `upload:{objectKey}` | userId · 용도 | Presigned 만료와 같게 | 2.5·5.7·6.2에서 "본인에게 발급된 키"인지 확인 |
| `idem:{userId}:{Idempotency-Key}` | 요청 본문 해시 + 첫 응답(상태·본문) | 24시간 | 5.1·5.4·5.7·5.8 (8장) |

ERD 메모의 "비밀번호 재설정 토큰"은 비밀번호 찾기가 MVP 제외라 지금은 쓰지 않는다.

## 8. 멱등성 **[제안]**
1. 요청 처리 전에 `idem:` 키를 `SET NX`로 잡는다(처리 중 표시)
2. 이미 있고 본문 해시가 같으면 저장된 첫 응답을 그대로 돌려준다. 해시가 다르면 409 `IDEMPOTENCY_KEY_REUSED`
3. 처리가 끝나면 응답을 저장한다. 처리 중 실패하면 키를 지워 재시도를 허용한다
4. 같은 키로 동시에 들어온 두 번째 요청이 아직 처리 중이면 409로 응답한다(처리 중 표시 확인)

## 9. 인증 **[제안]**
- 액세스 토큰: JWT(짧게), 리프레시 토큰: 불투명 값 + Redis(길게, 자동 로그인 유지)
- 재발급마다 리프레시 토큰을 새로 발급하고 이전 값은 폐기(회전). 폐기된 값으로 요청하면 401 `REFRESH_TOKEN_INVALID`
- 탈퇴·로그아웃 시 해당 회원의 리프레시 토큰을 모두 삭제
- WebSocket 인증 방식 **[미정] B-11**(연결 직후 첫 메시지로 토큰 전송 제안)

## 10. 파일 (S3) **[제안]**

| 용도 | 키 규칙 | 업로드 | 조회 |
|---|---|---|---|
| 프로필 사진 | `profile/{userId}/{uuid}.{ext}` | 2.4 Presigned PUT(JPG·PNG, 5MB) | 응답마다 Presigned GET |
| 답변 음성 | `sessions/{sessionId}/answers/{questionId}.{ext}` | 5.6 | 분석에서만 사용 |
| 면접 녹화 | `sessions/{sessionId}/session.{ext}` | 6.1(용량이 크면 멀티파트) | 6.4 Presigned GET |

- 등록 API(2.5·5.7·6.2)는 S3에 실제 파일이 있는지 확인한다. 없으면 404 `FILE_NOT_FOUND`
- 녹화 보관 기간·탈퇴 시 삭제 범위 **[미정] B-6**

## 11. 오류 처리 **[결정]**
- 응답 형식: ProblemDetail + `code`(+ 400은 `errors`). `GlobalExceptionHandler`가 Spring 자체 오류에도 `code`를 붙인다
- 업무 오류: `throw new ApiException(ErrorCode.X)`. 필드 사이 검증 실패: `FieldValidationException(field, reason)`
- 상태 오류는 엔티티가 던진다(4장)

## 12. 남은 일
1. Controller · Service · Repository 층(Controller는 `mock/`에서 옮김)
2. 공통 오류 처리 · Swagger 설정을 `mock/`에서 옮김
3. Redis · S3 · 면접 AI 모듈 · STT 어댑터
4. Security(JWT 필터, `@AuthenticationPrincipal`로 회원 id)
5. WebSocket 서버(메시지 계약은 [API 명세 3장](API-명세.md#3-실시간-websocket))
6. 비동기 작업(플랜 생성 · 다음 질문 · 결과 생성 · 시선 분석) 실행 방식: `@Async` / 메시지 큐 중 선택 **[미정]**
