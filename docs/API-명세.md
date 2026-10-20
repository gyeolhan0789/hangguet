# A301 API 명세

> API별 요청·응답 형식과 예시는 목 서버 Swagger에서 본다. 이 문서는 Swagger에 담지 않는 **공통 규약, 업무 규칙, 화면 대응, 오류 코드, 보류 목록**을 적는다.
>
> - Swagger: https://hangguet.yobistory.com/mock/be/docs (로컬: `mock/`에서 `./gradlew bootRun` → http://localhost:8080/docs)
> - 화면 번호(S00~S09·C01)는 화면 설계 기준
> - API 번호(1.1, 5.10 등)는 Swagger 요약 앞 번호와 같다
> - 면접 AI 내부 처리(작업·입출력·실패)는 [AI 명세](AI-명세.md)

## 목차

1. [공통 규약](#1-공통-규약)
2. [API](#2-api)
3. [오류 코드](#3-오류-코드)
4. [보류 · 확인 필요 (B)](#4-보류--확인-필요-b)

## 1. 공통 규약

- **기본 경로** `/api/v1`. Resource는 복수 명사·kebab-case, JSON 필드는 camelCase, enum은 UPPER_SNAKE_CASE
- **처리 서버** Nginx가 경로로 나눠 보낸다. 5.11은 AI 실시간 반응 서비스가, 나머지는 BE가 처리한다. 두 서버는 이 장의 규약을 똑같이 따른다
- **일시** ISO 8601 오프셋 포함(`2026-10-15T12:00:00+09:00`), **날짜** `YYYY-MM-DD`(한국 시간)
- **인증** `Authorization: Bearer {accessToken}`. 1.1~1.4만 토큰 없이 호출. 회원은 토큰으로만 식별(본문·경로로 회원 id를 받지 않음). 액세스 토큰은 JWT(HS256)이고 `sub`(회원 id)·`nickname`·`iat`·`exp`를 담는다. 리프레시 토큰은 JWT가 아닌 불투명한 문자열
- 다른 회원의 리소스는 존재 여부를 숨기기 위해 **404**. 탈퇴한 회원의 데이터는 조회되지 않음
- **성공 응답** 래퍼 없이 리소스 그대로. 본문 없는 성공은 204. 페이지 목록은 `{ content, page: { size, number(0부터), totalElements, totalPages } }`
- **실패 응답** RFC 9457 ProblemDetail(`title`·`status`·`detail`·`instance`, `type`은 기본값 `about:blank`라 생략) + `code`. 화면 분기는 `code`로 한다. 400 `VALIDATION_FAILED`는 `errors[{ field, reason }]` 추가. Nginx가 직접 주는 502·504는 본문 형식을 보장하지 않아 상태 코드로 판단한다
- **모든 API 공통 오류** 401 `UNAUTHORIZED`(토큰 없음·위조·탈퇴) · 401 `TOKEN_EXPIRED`(만료 → 토큰 재발급 후 재요청) · 400 `VALIDATION_FAILED` · 500 `INTERNAL_ERROR`(문구 고정 "잠시 후 다시 시도해 주세요.")
- **멱등성** 면접 만들기·시작·답변 제출·끝내기(5.1, 5.4, 5.7, 5.8)는 `Idempotency-Key: {UUID}` 필수. 같은 키·같은 본문 = 처음 결과 반환, 같은 키·다른 본문 = 409 `IDEMPOTENCY_KEY_REUSED`, 헤더 없음 = 400
- **파일** 음성·영상·사진은 Presigned URL로 브라우저가 S3에 직접 올리고 받음. API로 파일을 보내지 않음
- **상태 확인** WebSocket을 쓰지 않는다. 서버 작업이 끝났는지는 화면이 **2초마다(임시 값, B-11)** API를 다시 불러 확인한다
  - 질문 준비(S05): 5.2. `planStatus`가 `READY` 또는 `FAILED`가 되면 멈춘다
  - 다음 질문(S06·S06-B): 5.5. 202 대신 200(질문)이 오면 멈춘다
  - 결과 분석(S06-1): 5.2. `status`가 `COMPLETED` 또는 `FAILED`가 되면 멈춘다
- **연습 면접** 답변 1개 이상으로 끝난 면접(`ANALYZING`·`COMPLETED`·`FAILED`, `ABORTED` 제외). 스트릭·면접 수·연습 시간은 모두 이 기준
- **MVP 제외(API 없음)**: 비밀번호 찾기, 업적, 연습 알림 메일, 개발자 콘솔

목 서버는 실제 로직 없이 예시 응답을 돌려준다. 인증·DB는 없고, 경로의 id가 `0`이면 해당 404를 돌려준다(화면 오류 처리 확인용). 회원가입(1.2)은 요청한 닉네임으로, 로그인(1.3)·재발급(1.4)은 예시 회원(id 1, 닉네임 "면접왕")으로 액세스 토큰을 만든다. 토큰을 검사하지는 않는다. 5.10·5.12는 요청 헤더 `X-Soniox-Api-Key`·`X-ElevenLabs-Api-Key`로 받은 키로 실제 토큰을 발급한다(헤더가 없으면 400).

## 2. API

| 번호 | API | 메서드 · 경로 | 화면 |
|---|---|---|---|
| 1.1 | 이메일 사용 가능 여부 | `GET /auth/email-availability` | S01-1 |
| 1.2 | 회원가입 | `POST /auth/signup` | S01-1 |
| 1.3 | 로그인 | `POST /auth/login` | S01 |
| 1.4 | 토큰 재발급 | `POST /auth/token/refresh` | 공통 |
| 1.5 | 로그아웃 | `POST /auth/logout` | C01, S09-1 |
| 2.1 | 내 정보 | `GET /users/me` | C01, S09, S09-1 |
| 2.2 | 닉네임 변경 | `PATCH /users/me` | S09-1 |
| 2.3 | 비밀번호 변경 | `PATCH /users/me/password` | S09-1 |
| 2.4 | 프로필 사진 업로드 주소 | `POST /users/me/profile-image/upload-url` | S09-1 |
| 2.5 | 프로필 사진 등록 | `PUT /users/me/profile-image` | S09-1 |
| 2.6 | 프로필 사진 삭제 | `DELETE /users/me/profile-image` | S09-1 |
| 2.7 | 회원 탈퇴 | `POST /users/me` | S09-1 |
| 3.1 | 홈 | `GET /home` | S02 · S02-B · S02-C · S02-D, S02-1 |
| 3.2 | 통계 | `GET /users/me/stats` | S09 |
| 3.3 | 연습 달력 | `GET /practice-logs` | S09 |
| 4.1 | 지원서 작성 | `POST /applications` | S03 |
| 4.2 | 지원서 조회 | `GET /applications/{applicationId}` | S03, S04, S05-1 |
| 4.3 | 지원서 목록 | `GET /applications` | S03 |
| 4.4 | 지원서 수정 | `PATCH /applications/{applicationId}` | S03, S04 |
| 4.5 | 지원서 삭제 | `DELETE /applications/{applicationId}` | S03 |
| 5.1 | 면접 만들기 | `POST /interview-sessions` | S05-1 |
| 5.2 | 면접 조회 | `GET /interview-sessions/{sessionId}` | S05, S06 · S06-B, S06-F, S06-1 |
| 5.3 | 면접 플랜 재생성 | `POST /interview-sessions/{sessionId}/plan/retry` | S05 |
| 5.4 | 면접 시작 | `POST /interview-sessions/{sessionId}/start` | S05, S05-1 |
| 5.5 | 지금 질문 | `GET /interview-sessions/{sessionId}/questions/current` | S06 · S06-B |
| 5.6 | 답변 음성 업로드 주소 | `POST /interview-sessions/{sessionId}/questions/{questionId}/answer-audio/upload-url` | S06 |
| 5.7 | 답변 제출 | `POST /interview-sessions/{sessionId}/questions/{questionId}/answer` | S06, S06-B |
| 5.8 | 면접 끝내기 | `POST /interview-sessions/{sessionId}/end` | S06, S06-E, S06-F, S02-L |
| 5.9 | 결과 재생성 | `POST /interview-sessions/{sessionId}/analysis/retry` | S06-1 |
| 5.10 | 실시간 음성 인식 토큰 | `POST /interview-sessions/{sessionId}/stt-token` | S06 |
| 5.11 | 면접관 리액션 | `POST /interview-sessions/{sessionId}/questions/{questionId}/reactions` | S06 · S06-B |
| 5.12 | 질문 음성 토큰 | `POST /interview-sessions/{sessionId}/questions/{questionId}/tts-token` | S06 · S06-B |
| 6.1 | 녹화 업로드 주소 | `POST /interview-sessions/{sessionId}/recordings/upload-url` | S06 |
| 6.2 | 녹화 등록 | `POST /interview-sessions/{sessionId}/recordings` | S06 |
| 6.3 | 면접 결과 | `GET /interview-sessions/{sessionId}/result` | S07 |
| 6.4 | 다시보기 | `GET /interview-sessions/{sessionId}/replay` | S07-1 |
| 7.1 | 날짜별 성장 리뷰 | `GET /growth-reviews/{practiceDate}` | S08, S08-C, S09, S02 |
| 7.2 | 최근 성장 리뷰 | `GET /growth-reviews` | S02 |

경로는 모두 `/api/v1` 뒤에 붙는다. 아래 응답 목록의 공통 오류(401·400 `VALIDATION_FAILED`·500)는 1장 기준이라 따로 적지 않은 곳이 있다.

### 1. 인증

#### 1.1 이메일 사용 가능 여부

**화면 — S01-1 회원가입 › 이메일 입력 즉시 검사**

탈퇴하지 않은 회원 중 같은 이메일이 없으면 사용 가능하다. 탈퇴한 회원이 쓰던 이메일은 다시 쓸 수 있다.

- **200**: 항상. 사용 중이면 `available: false`(오류 아님)

#### 1.2 회원가입

**화면 — S01-1 회원가입 › [가입하고 시작하기]**

회원을 만들고 필수 약관 3개 동의를 기록한 뒤 로그인 토큰을 준다. 화면은 S02-D(첫 방문 홈)로 간다.

필수 약관은 `TERMS`(이용약관) · `PRIVACY`(개인정보 수집·이용) · `RECORDING`(면접 녹화·음성 이용) 3개다. `agreements`에 3개를 모두 보내며, 버전은 화면에 보여 준 약관 버전이다.

- **201**: 가입 완료. 로그인 상태
- **400 / AGREEMENT_REQUIRED**: 약관 3개 중 하나라도 없음. 가입하지 않음
- **400 / VALIDATION_FAILED**: 이메일·비밀번호·닉네임 조건 불일치, `agreements`가 3개가 아님. 칸마다 `errors`
- **409 / EMAIL_DUPLICATED**: 사용 중인 이메일(1.1 이후 다른 사람이 먼저 가입한 경우 포함)

#### 1.3 로그인

**화면 — S01 로그인 › [로그인]** → S02 홈(하루 첫 진입이면 S02-1)

여러 기기의 동시 로그인을 허용하며, 새 로그인은 다른 기기의 리프레시 토큰을 폐기하지 않는다.

자동 로그인 유지(스트릭 유지 목적)를 위해 리프레시 토큰 유효 기간을 길게 둔다(값은 BE 결정). 비밀번호 찾기는 MVP 제외.

- **200**: 이메일·비밀번호 일치
- **401 / LOGIN_FAILED**: 이메일 없음·비밀번호 틀림·탈퇴 회원. 구분 없이 같은 문구

#### 1.4 토큰 재발급

**화면 — 공통. 액세스 토큰 만료 시**

새 액세스·리프레시 토큰을 준다. 쓴 리프레시 토큰만 폐기되며 다른 기기의 토큰은 유지된다.

- **200**: 유효한 리프레시 토큰
- **401 / REFRESH_TOKEN_INVALID**: 만료·재사용·로그아웃·탈퇴로 폐기됨. 화면은 S01로

#### 1.5 로그아웃

**화면 — C01 프로필 메뉴, S09-1 설정** → 확인 없이 S00

- **204**: 인증한 회원이 제출한 리프레시 토큰만 폐기한다. 다른 기기의 토큰은 유지한다. 이미 폐기된 토큰이어도 204. 발급된 액세스 토큰은 만료 전까지 유지된다.

### 2. 회원

#### 2.1 내 정보

**화면 — C01 헤더, S09 상단, S09-1 계정**

- **200**: 항상

#### 2.2 닉네임 변경

**화면 — S09-1 설정 › 닉네임**

- **200**: 변경(같은 값이어도 200). 응답은 2.1과 같음

#### 2.3 비밀번호 변경

**화면 — S09-1 설정 › 비밀번호 변경**

- **204**: 변경. 다른 기기 로그인은 유지
- **400 / PASSWORD_MISMATCH**: 현재 비밀번호 틀림

#### 2.4 프로필 사진 업로드 주소

**화면 — S09-1 설정 › [사진 변경]** → 받은 주소로 `PUT` 후 2.5

- **200**: 발급
- **400 / VALIDATION_FAILED**: JPG·PNG가 아니거나 5MB 초과

#### 2.5 프로필 사진 등록

**화면 — S09-1 설정 › 업로드 완료 직후**

- **200**: 등록. 응답은 2.1과 같음
- **400 / VALIDATION_FAILED**: 본인에게 발급된 키가 아님
- **404 / FILE_NOT_FOUND**: S3에 파일 없음

#### 2.6 프로필 사진 삭제

**화면 — S09-1 설정 › [삭제]**

- **204**: 삭제(이미 없어도 204)

#### 2.7 회원 탈퇴

**화면 — S09-1 설정 › 회원 탈퇴 › 확인 모달**

탈퇴 처리하고 모든 토큰을 폐기한다. 되돌릴 수 없고, 이메일은 재가입에 쓸 수 있다. 데이터 삭제 범위는 약관을 따른다(B-6).

- **204**: 탈퇴
- **400 / PASSWORD_MISMATCH**: 비밀번호 틀림

### 3. 홈 · 스트릭

**스트릭 규칙**: 연습 면접 = 답변 1개 이상으로 끝난 면접(`ANALYZING`·`COMPLETED`·`FAILED`, `ABORTED` 제외). 연습한 날 = 연습 면접이 있는 날. 스트릭 = 오늘(또는 어제)까지 빠짐없이 이어진 연습일 수, 하루라도 빠지면 0. 스트릭은 연습 면접을 끝낸 순간(5.8) 오른다. 뱃지 구간 0 / 1–2 / 3–5 / 6–7 / 8–13 / 14+일(1·3·6·8·14일째에 다음 구간으로 레벨업).

#### 3.1 홈

**화면 — S02 · S02-B · S02-C · S02-D, S02-1 인트로**

홈 한 장에 필요한 값을 한 번에 준다. 어떤 홈을 그릴지는 `homeState`로 정한다. 자정까지 남은 시간, 인트로 하루 1회 노출은 화면이 처리한다.

- **200**: 항상. 기록이 없으면 `FIRST_VISIT`, 숫자 0, 배열 빈 배열

#### 3.2 통계

**화면 — S09 마이페이지 › 통계 타일, 이름 아래 직무**

- **200**: 항상. 기록이 없으면 0·null

#### 3.3 연습 달력

**화면 — S09 마이페이지 › 스트릭 달력** → 날짜 클릭 시 7.1

"이번 달 10일 연습"은 `content` 개수, "지금 7일 연속"은 3.2 `currentStreak`, 연속일 띠는 날짜가 이어지는지로 화면이 그린다.

- **200**: 항상. 없으면 빈 배열
- **400 / VALIDATION_FAILED**: `month` 형식 오류

### 4. 지원서

#### 4.1 지원서 작성

**화면 — S03 지원서 › [새 지원서 작성] 후 [다음: 면접관 선택]**

지원서를 저장해 두고 여러 면접에 다시 쓴다(S03에서 저장된 지원서 중 고르거나 새로 작성). 자기소개서는 질문 생성과 "자소서 검증" 평가에 쓴다.

- **201**: 저장

#### 4.2 지원서 조회

**화면 — S03 저장된 지원서 선택 시 내용 보기, S04·S05-1 상단 "○○전자 · 백엔드 개발자", S04 [← 지원서 수정] 시 S03 채우기**

- **200**: 본인 지원서
- **404 / APPLICATION_NOT_FOUND**: 없거나 남의 지원서

#### 4.3 지원서 목록

**화면 — S03 지원서 › 저장된 지원서 목록**

최근 작성 순. 목록에는 자기소개서 본문을 넣지 않는다(선택하면 4.2).

- **200**: 항상. 없으면 빈 배열 → S03은 바로 새로 작성 화면

#### 4.4 지원서 수정

**화면 — S03 저장된 지원서 › 수정, S04 [← 지원서 수정]**

보낸 필드만 바꾼다. 이미 면접에 쓴 지원서는 고칠 수 없다(지난 결과가 바뀌지 않도록). 화면은 내용을 채운 새 작성(4.1)으로 안내한다.

- **200**: 수정. 응답은 4.1과 같음
- **404 / APPLICATION_NOT_FOUND**
- **409 / APPLICATION_IN_USE**: 면접에 쓴 지원서

#### 4.5 지원서 삭제

**화면 — S03 저장된 지원서 › 삭제**

지원서를 지운다. 이미 면접에 쓴 지원서는 지울 수 없다(지난 결과·다시보기가 이 지원서를 보여 준다).

- **204**: 삭제
- **404 / APPLICATION_NOT_FOUND**: 없거나 남의 지원서
- **409 / APPLICATION_IN_USE**: 면접에 쓴 지원서

### 5. 면접 진행

**면접 상태** `READY` → (시작) `IN_PROGRESS` → (끝내기, 답변 ≥1) `ANALYZING` → `COMPLETED` / `FAILED`(결과 재생성으로 `ANALYZING`). 답변 0개로 끝내면 `ABORTED`.

**면접 플랜 상태** `planStatus`: `GENERATING` · `READY` · `FAILED`. **분석 단계** `analysisStep`: `ORGANIZING_ANSWERS` → `SCORING` → `WRITING_FEEDBACK`.

#### 5.1 면접 만들기

**화면 — S05-1 면접 방식 › [다음: 장치 점검](화상) · [면접 시작](채팅)**

면접을 만들고 면접 플랜(질문·평가 기준) 생성을 시작한다(사용자에게 비노출). 완료는 5.2를 2초마다(임시 값) 불러 `planStatus`로 확인한다(1장 상태 확인).

- **201**: 생성(`status: READY`, `planStatus: GENERATING`)
- **404 / APPLICATION_NOT_FOUND**: 없거나 남의 지원서
- **409 / IDEMPOTENCY_KEY_REUSED**: 같은 키로 다른 본문

#### 5.2 면접 조회

**화면 — S05 [면접 시작] 활성화, S06·S06-B 상단, S06-F 재연결 복구, S06-1 진행**

질문 준비(`planStatus`·`planProgress`)와 결과 분석(`status`·`analysisStep`)이 끝났는지 이 API를 2초마다(임시 값) 불러 확인한다(1장 상태 확인). 새로고침·재연결 때도 이 응답으로 화면을 다시 그린다. "질문 3 / 5"의 전체 질문 수는 5개로 고정이다. `leveledUp`은 5.8 응답에만 값이 있고, 이 API에서는 항상 null이다.

- **200**: 본인 면접
- **404 / SESSION_NOT_FOUND**: 없거나 남의 면접

#### 5.3 면접 플랜 재생성

**화면 — S05 장치 점검 › 생성 실패 › [다시 시도]**

- **202**: 재생성 시작. 5.2 형식(`planStatus: GENERATING`)
- **404 / SESSION_NOT_FOUND**
- **409 / PLAN_NOT_FAILED**: `planStatus`가 `FAILED`가 아님

#### 5.4 면접 시작

**화면 — S05 [면접 시작](화상), S05-1 [면접 시작](채팅)**

면접을 시작하고 첫 질문을 준다. 화상은 이 응답 시점에 녹화를 시작한다(6.4 질문 시점의 기준). 첫 질문 음성은 5.12로 받는다.

채팅은 장치 점검 없이 5.1 직후 S06-B로 바로 넘어간다. 면접관을 띄워 둔 채 5.2에서 `planStatus: READY`를 받으면 화면이 이 API를 자동으로 부른다. 별도 대기 화면은 없다.

- **200**: 시작. 5.2 형식(`status: IN_PROGRESS`, `currentQuestion` = 1번 질문)
- **404 / SESSION_NOT_FOUND**
- **409 / PLAN_NOT_READY**: 플랜 생성 중이거나 실패
- **409 / INVALID_SESSION_STATE**: `READY`가 아님

#### 5.5 지금 질문

**화면 — S06·S06-B 질문 말풍선**

답변을 낸 뒤 다음 질문을 받을 때 부른다.

- **200**: 답할 질문 있음
- **202 / QUESTION_GENERATING**: 다음 질문 생성 중. 오류가 아니라 본문은 `{ "code": "QUESTION_GENERATING" }`만. 2초 뒤(임시 값) 다시 부른다
- **404 / SESSION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님

질문 음성은 5.12로 받는다.

#### 5.6 답변 음성 업로드 주소

**화면 — S06 화상 › 답변 녹음 시작**

응답은 2.4와 같은 형식. `objectKey`는 5.7 `audioObjectKey`로 보낸다.

- **200**: 발급
- **404 / SESSION_NOT_FOUND** · **QUESTION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: 화상 면접 중이 아님

#### 5.7 답변 제출

**화면 — S06 [답변 완료] 또는 침묵, S06-B [보내기]**

질문 하나에 답변 하나만 낼 수 있다. 화상은 실시간 음성 인식(5.10)의 최종 글과 음성 키를, 채팅은 입력한 글을 보낸다. 음성 파일은 음성 지표 분석·보관용이다. 다음 질문은 5.5로 받는다. 답변별 채점은 제출 직후 시작하고, 결과(6.3)는 면접 종료 후 확정된다.

화상은 음성 인식이 확정한 토큰과 말한 시각(`tokens`)을 함께 보낼 수 있다. 말하기 지표 계산에 쓰며, 없으면 그 지표만 비어 있다.

- 음성 인식이 준 확정 토큰을 그대로 보낸다(단어 일부·공백 포함, 단어로 합치지 않음). `<end>`·`<fin>` 표시 토큰은 뺀다
- 시각은 답변 음성 파일(5.6) 시작 기준 밀리초. 화면은 음성 인식 시각에 "음성 인식이 받은 첫 음성의 시작 − 파일 시작"(음수일 수 있음)을 더해 보낸다. 다시 연결하면 연결마다 따로 구한다
- `content`와 글자가 맞는지는 검사하지 않는다. 채점은 `content`로 한다

- **202**: 접수
- **400 / VALIDATION_FAILED**: `content` 길이 초과(TEXT 1,000자 / VOICE 10,000자), VOICE인데 `audioObjectKey` 없음, TEXT인데 `tokens`를 보냄(빈 배열 포함), `tokens` 10,000개 초과·빈 원소·`endMs` < `startMs`, `inputType`이 면접 방식과 다름
- **404 / SESSION_NOT_FOUND** · **QUESTION_NOT_FOUND**(질문이 경로의 면접에 속하지 않거나 아직 내지 않은 질문) · **FILE_NOT_FOUND**(음성 파일 없음)
- **409 / ANSWER_ALREADY_SUBMITTED**: 이미 답변함(다른 키로 재전송)
- **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님

#### 5.8 면접 끝내기

**화면 — 마지막 답변 후 자동, S06-E [끝내기], S06-F [면접 끝내기]**

본문 없음. 답변 1개 이상이면 결과 생성을 시작하고 그날 연습으로 인정한다. 0개면 결과·연습 인정 없이 끝난다.

**레벨업** `leveledUp`: 이번 면접으로 스트릭이 올라 뱃지 구간이 바뀌었으면 true다. 그날 첫 연습 면접이고 스트릭이 1·3·6·8·14일이 된 경우다. 같은 날 두 번째 면접, 답변 0개로 끝낸 면접은 false. 면접 끝내기는 면접마다 한 번만 호출되므로 레벨업도 한 번만 온다. 화면은 이 값을 기억해 뒀다가 결과 분석이 끝난 뒤 S08에서 레벨업(S02-L)을 띄운다.

- **202**: 답변 ≥1. 5.2 형식(`status: ANALYZING`). 완료는 5.2를 2초마다(임시 값) 불러 확인
- **200**: 답변 0. 5.2 형식(`status: ABORTED`). 화면은 홈으로
- **404 / SESSION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님

#### 5.9 결과 재생성

**화면 — S06-1 › 실패 › [다시 시도]**

- **202**: 재생성 시작. 5.2 형식(`status: ANALYZING`)
- **404 / SESSION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: `FAILED`가 아님

#### 5.10 실시간 음성 인식 토큰

**화면 — S06 화상 › 답변을 듣기 시작할 때마다**

브라우저가 Soniox 실시간 음성 인식(`stt-rt-v5`)에 직접 연결할 1회용 임시 키를 준다. 회사 API 키는 서버에만 두고, 음성은 BE를 거치지 않는다([CONTRIBUTING 7](CONTRIBUTING.md#7-음성websocketai-job-금지사항)). 화면은 받아 적는 글을 S06 자막으로 보여 주고, 답변 도중 확정된 문장은 5.11로, 최종 글은 5.7 `content`로, 확정 토큰과 말한 시각은 5.7 `tokens`로 보낸다.

키는 연결 1번에만 쓸 수 있어 답변마다 새로 받는다. 받은 뒤 5분(`expiresAt`) 안에 연결을 시작해야 하며, 연결된 뒤에는 만료와 관계없이 이어진다.

- **200**: 발급
- **404 / SESSION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: 화상 면접 중이 아님
- **503 / STT_UNAVAILABLE**: Soniox 키 발급 실패. 잠시 뒤 재시도

#### 5.11 면접관 리액션

**화면 — S06·S06-B › 답변하는 도중**

답변하는 도중 화면이 답변 글을 보내고, 서버는 면접관 리액션을 돌려준다. 리액션은 반응 로직 모듈이 정한다. 화상·채팅 모두 쓴다.

- 화상은 음성 인식 결과에서 문장이 끝날 때마다(기준 B-15) 그 문장을 보낸다. `pauseMs`는 문장을 말한 뒤 쉰 시간이다
- 채팅은 입력이 0.8초(임시 값) 멈출 때마다 입력 칸의 글 전체를 보낸다. 글이 비었거나 공백뿐이거나 마지막으로 보낸 글과 같으면 보내지 않는다. `pauseMs`는 입력을 멈춘 시간이다
- 보낸 글은 저장하지 않는다. 저장되는 답변은 5.7로 낸 전체 글이다
- 화상 자막은 화면이 음성 인식 서비스에서 받은 글로 바로 보여 주며, 이 API의 응답을 기다리지 않는다
- 응답이 보낸 순서와 다르게 도착하면 가장 큰 `seq`의 응답만 쓴다. 요청을 보낸 뒤 `ttlMs`가 지나 도착했거나 5.7을 낸 뒤 도착한 응답은 버린다
- `interrupt`의 `text`는 면접관이 말을 끊으며 하는 말이라 자막으로 보여 준다. 채팅은 `interrupt`가 항상 null이다
- 화상에서 말하다 잠깐 쉴 때의 끄덕임과 오래 침묵할 때의 안내는 화면이 직접 처리한다(서버 호출 없음)
- 서버가 리액션을 정하지 못하면(시간 초과·실패) `reaction: null`로 200을 준다. Nginx 502·504면 화면은 리액션 없이 진행한다

**리액션 값** 필드는 Swagger `Reaction`·`Attitude` 스키마를 따른다. 면접관 방식에 따라 화면이 값을 쓰는 방법이 다르고, 반응 로직 모듈은 면접관 방식을 몰라도 된다(B-8).

| 값 | 코드로 변형 (후보 2개) | 표정별 이미지 (후보 1개) |
|---|---|---|
| `state`: `idle` · `listening` · `thinking` · `speaking` | 자세·시선·입 움직임으로 표현 | 상태별 기본 이미지 |
| `expression`: `smile` · `frown` · `smirk` | `intensity`(세기)에 따라 연속 변형 | 표정별 이미지. `intensity` 무시 |
| `gesture`: `small_nod` · `nod` · `tilt` | 끄덕·갸웃 동작 | 무시 |
| `attitude`: `interest` · `trust` · `tension` (0~1) | 표정이 서서히 바뀜 | 무시 |
| `durationMs` | 순간 표정 유지 시간 | 이미지 표시 시간. 끝나면 `state` 이미지로 복귀 |

- **200**: 리액션
- **404 / SESSION_NOT_FOUND** · **QUESTION_NOT_FOUND**: 질문이 경로의 면접에 속하지 않거나 아직 내지 않은 질문
- **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님
- **409 / ANSWER_ALREADY_SUBMITTED**: 이미 5.7로 답변을 낸 질문

#### 5.12 질문 음성 토큰

**화면 — S06·S06-B 질문 말풍선 › 질문 음성 재생**

브라우저가 TTS 회사(ElevenLabs)에 직접 스트리밍 연결할 1회용 임시 토큰을 준다. API 키는 서버에만 두고, 음성은 서버를 거치지 않는다. 화면은 5.4·5.5로 질문을 받은 직후 이 API를 부르고, 받은 `voiceId`·`modelId`로 연결해 질문 글(`content`)을 보내 음성과 글자별 발음 시각을 받는다. 화상·채팅 모두 쓴다.

- 토큰은 연결 1번에만 쓸 수 있고, `expiresAt`이 지나면 만료된다. 연결이 끊기거나 만료되면 다시 부른다
- 글자별 발음 시각은 연결할 때 `sync_alignment=true`를 줘야 온다(ElevenLabs 기본값은 false)
- 이미 답변을 낸 질문도 막지 않는다(재연결 시 다시 듣기)
- 503, Nginx 502·504, 연결 실패·끊김이면 질문 글만 보여 주고 면접을 계속한다

- **200**: 발급
- **404 / SESSION_NOT_FOUND** · **QUESTION_NOT_FOUND**: 질문이 경로의 면접에 속하지 않거나 아직 내지 않은 질문
- **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님
- **503 / TTS_UNAVAILABLE**: TTS 회사 토큰 발급 실패

### 6. 녹화 · 결과 · 다시보기

#### 6.1 녹화 업로드 주소

**화면 — S06 화상 › 면접 종료 시**

녹화 동의는 가입 때 받는다(1.2 `RECORDING`). 응답은 2.4와 같은 형식. 용량이 크면 멀티파트 업로드로 바뀔 수 있다(BE 결정).

- **200**: 발급
- **404 / SESSION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: 화상 면접이 아니거나 시작 전

#### 6.2 녹화 등록

**화면 — S06 녹화 업로드 완료 직후**

등록된 영상으로 시선 응시 비율(6.3 `speechMetrics.gazeRatio`)을 구한다.

- **201**: 등록
- **404 / FILE_NOT_FOUND**: S3에 파일 없음
- **409 / RECORDING_ALREADY_EXISTS**: 이 면접에 녹화가 이미 있음(면접당 1개, 서버에서 확인)

#### 6.3 면접 결과

**화면 — S07 피드백 결과**

면접 1회 결과. 화면은 점수 대신 좋아요·보통·아쉬워요로 보여 준다. 반응 썸네일은 면접관별 고정 이미지라 API 필드가 없다. 채팅 면접은 같은 형식에 `mode: CHAT`, `speechMetrics: null`. 채팅도 기준 4개 점수가 모두 나온다. 전달력은 화상이면 답변 글과 말하기 지표로, 채팅이면 답변 글로 판단한다. 말하기 지표가 비어 있으면 그 지표는 빼고 판단한다.

`grade`는 점수로 계산한다: 80 이상 `GOOD`, 60 이상 `NORMAL`, 그 외 `WEAK`. 6.4·7.1도 같다.

화면 표시: 기준 이름(`JOB_FIT` → 직무 적합성, `COVER_LETTER` → 자소서 검증, `LOGIC` → 논리성, `DELIVERY` → 전달력)과 `grade` 문구는 화면이 바꾼다. 질문별 피드백은 첫 번째 `WEAK`·`NORMAL` 질문만 펼친다.

- **200**: `COMPLETED`
- **404 / SESSION_NOT_FOUND**
- **409 / RESULT_NOT_READY**: `ANALYZING` 또는 `FAILED`. 화면은 S06-1로
- **409 / NO_RESULT**: `ABORTED`

#### 6.4 다시보기

**화면 — S07-1 면접 다시보기**

화상은 녹화 영상과 질문별 시점(마커), 채팅은 같은 목록을 대화 기록으로 준다(`mode: CHAT`, `videoUrl: null`). 재생 중 자막은 재생 위치가 속한 질문(`questionCreatedAt` ≤ 위치 < 다음 질문)의 `answer`.

- **200**: `COMPLETED`
- **404 / SESSION_NOT_FOUND**
- **409 / RESULT_NOT_READY** · **NO_RESULT**: 6.3과 같음

### 7. 성장 리뷰

저장하지 않고 조회 시 계산. 그날 점수 = 그날 `COMPLETED` 면접들의 기준별 평균. 비교 대상 = 직전 연습일. `delta` = 그날 − 비교 대상(첫 연습일 null). 다음에 해볼 것 = 그날 평가 기준 점수와 질문별 점수 중 가장 낮은 것의 문구(기준은 `comment`, 질문은 `improvePoint`), 동점이면 모두.

#### 7.1 날짜별 성장 리뷰

**화면 — S08(오늘), S08-C(첫 면접), S09 달력 날짜, S02 최근 리뷰 [보기]**

화면 표시: S08 "오늘 나아진 점"은 `delta` > 0인 기준. 자소서 검증(`COVER_LETTER`)은 `delta` 없이 `comment`만(`grade`가 `GOOD`이면 "막힘 없이 통과"). S08-C는 `delta` 대신 `grade`로 기준점. 설문 유도(S08-B, 3·7·21일째)는 화면이 `streakOnDate`로 판단해 외부 구글폼을 연다.

- **200**: 그날 결과가 있음
- **404 / GROWTH_REVIEW_NOT_FOUND**: 그날 연습 기록 또는 결과가 없음

#### 7.2 최근 성장 리뷰

**화면 — S02 홈 › 최근 성장 리뷰**(3.1에도 포함)

페이지 목록, 최근 날짜 순.

- **200**: 항상. 없으면 빈 배열

## 3. 오류 코드

| code | 상태 | API |
|---|---|---|
| `UNAUTHORIZED` · `TOKEN_EXPIRED` | 401 | 인증 필요한 전부 |
| `VALIDATION_FAILED` | 400 | 본문·쿼리가 있는 전부 |
| `INTERNAL_ERROR` | 500 | 전부 |
| `LOGIN_FAILED` · `REFRESH_TOKEN_INVALID` | 401 | 1.3 · 1.4 |
| `AGREEMENT_REQUIRED` · `EMAIL_DUPLICATED` | 400 · 409 | 1.2 |
| `PASSWORD_MISMATCH` | 400 | 2.3, 2.7 |
| `FILE_NOT_FOUND` | 404 | 2.5, 5.7, 6.2 |
| `APPLICATION_NOT_FOUND` · `APPLICATION_IN_USE` | 404 · 409 | 4.x, 5.1 |
| `SESSION_NOT_FOUND` · `QUESTION_NOT_FOUND` | 404 | 5.x, 6.x |
| `IDEMPOTENCY_KEY_REUSED` | 409 | 5.1, 5.4, 5.7, 5.8 |
| `INVALID_SESSION_STATE` | 409 | 5.4~5.12, 6.1 |
| `PLAN_NOT_READY` · `PLAN_NOT_FAILED` | 409 | 5.4 · 5.3 |
| `ANSWER_ALREADY_SUBMITTED` | 409 | 5.7, 5.11 |
| `STT_UNAVAILABLE` | 503 | 5.10 |
| `TTS_UNAVAILABLE` | 503 | 5.12 |
| `RECORDING_ALREADY_EXISTS` | 409 | 6.2 |
| `RESULT_NOT_READY` · `NO_RESULT` | 409 | 6.3, 6.4 |
| `GROWTH_REVIEW_NOT_FOUND` | 404 | 7.1 |
| `QUESTION_GENERATING` | 202(오류 아님) | 5.5 |

## 4. 보류 · 확인 필요 (B)

| # | 내용 | 영향 | 담당 |
|---|---|---|---|
| B-5 | 오늘 완료 기준(현재: 답변 1개 이상인 면접 종료). 성장 리뷰까지 봐야 완료인지 | 3.1, 5.8 | 화면 |
| B-6 | 탈퇴 시 삭제 범위, 녹화 보관 기간 | 2.7, 6.x | 약관 |
| B-7 | 설문 노출·참여, 재방문 지표(D1·D3·D7) 저장 | 7.1 | 이벤트 로깅 |
| B-8 | 면접관별 리액션 방식(코드로 변형 / 표정별 이미지), 표정 이미지 목록 | 5.11 | 면접관 표현 모듈 |
| B-9 | ERD 반영 대기: `interview_plans`(질문 5개·질문별 채점 기준), `answers.tokens`, `answers.evaluation`, 회사 요약 Table. 형식은 [AI 명세](AI-명세.md) | 5.1~5.7, 6.3 | ERD |
| B-11 | 상태 확인 간격(지금 임시 2초), 최대 대기 시간과 넘었을 때 화면 | 5.2, 5.5 | 화면 · BE |
| B-12 | JWT 검증 위치: AI 서비스(현재 CONTRIBUTING 7장) / Nginx에서 한 번에 검증 | 5.11 | Infra |
| B-13 | 말 속도 지표(`speedDeviationPct`)의 "평소" 기준 | 6.3 | 면접 AI 모듈 |
| B-14 | 시선 지표(`gazeRatio`)를 계산하는 주체와 시점 | 6.3 | 면접 AI 모듈 |
| B-15 | 5.11 화상 문장 확정 기준. 후보: 종결어미(-다·-요·-까 등)로 끝난 확정 토큰 + 짧은 쉼(끝 감지 `<end>`는 놓쳤을 때 보조) / 끝 감지만 / 문장부호. 한국어 문장부호 출력과 끝 감지 지연은 실측 필요 | 5.11 | 화면 · 면접 AI 모듈 |
