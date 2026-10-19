# A301 API 명세

> API별 요청·응답 형식과 예시는 목 서버 Swagger에서 본다. 이 문서는 Swagger에 담지 않는 **공통 규약, 실시간(WebSocket) 계약, 업무 규칙, 화면 대응, 오류 코드, 보류 목록**을 적는다.
>
> - Swagger: https://hangguet.yobistory.com/mock/be/docs (로컬: `mock/`에서 `./gradlew bootRun` → http://localhost:8080/docs)
> - 화면 번호(S00~S09·C01)는 화면 설계 기준
> - API 번호(1.1, 5.10 등)는 Swagger 요약 앞 번호와 같다

## 목차

1. [공통 규약](#1-공통-규약)
2. [API](#2-api)
3. [실시간 (WebSocket)](#3-실시간-websocket)
4. [오류 코드](#4-오류-코드)
5. [보류 · 확인 필요 (B)](#5-보류--확인-필요-b)

## 1. 공통 규약

- **기본 경로** `/api/v1`. Resource는 복수 명사·kebab-case, JSON 필드는 camelCase, enum은 UPPER_SNAKE_CASE
- **일시** ISO 8601 오프셋 포함(`2026-10-15T12:00:00+09:00`), **날짜** `YYYY-MM-DD`(한국 시간)
- **인증** `Authorization: Bearer {accessToken}`. 1.1~1.4만 토큰 없이 호출. 회원은 토큰으로만 식별(본문·경로로 회원 id를 받지 않음). 액세스 토큰은 JWT(HS256)이고 `sub`(회원 id)·`nickname`·`iat`·`exp`를 담는다. 리프레시 토큰은 JWT가 아닌 불투명한 문자열
- 다른 회원의 리소스는 존재 여부를 숨기기 위해 **404**. 탈퇴한 회원의 데이터는 조회되지 않음
- **성공 응답** 래퍼 없이 리소스 그대로. 본문 없는 성공은 204. 페이지 목록은 `{ content, page: { size, number(0부터), totalElements, totalPages } }`
- **실패 응답** RFC 9457 ProblemDetail(`title`·`status`·`detail`·`instance`, `type`은 기본값 `about:blank`라 생략) + `code`. 화면 분기는 `code`로 한다. 400 `VALIDATION_FAILED`는 `errors[{ field, reason }]` 추가
- **모든 API 공통 오류** 401 `UNAUTHORIZED`(토큰 없음·위조·탈퇴) · 401 `TOKEN_EXPIRED`(만료 → 토큰 재발급 후 재요청) · 400 `VALIDATION_FAILED` · 500 `INTERNAL_ERROR`(문구 고정 "잠시 후 다시 시도해 주세요.")
- **멱등성** 면접 만들기·시작·답변 제출·끝내기(5.1, 5.4, 5.7, 5.8)는 `Idempotency-Key: {UUID}` 필수. 같은 키·같은 본문 = 처음 결과 반환, 같은 키·다른 본문 = 409 `IDEMPOTENCY_KEY_REUSED`, 헤더 없음 = 400
- **파일** 음성·영상·사진은 Presigned URL로 브라우저가 S3에 직접 올리고 받음. API·WebSocket으로 파일을 보내지 않음
- **연습 면접** 답변 1개 이상으로 끝난 면접(`ANALYZING`·`COMPLETED`·`FAILED`, `ABORTED` 제외). 스트릭·면접 수·연습 시간은 모두 이 기준
- **MVP 제외(API 없음)**: 비밀번호 찾기, 업적, 연습 알림 메일, 개발자 콘솔

목 서버는 실제 로직 없이 예시 응답을 돌려준다. 인증·DB는 없고, 경로의 id가 `0`이면 해당 404를 돌려준다(화면 오류 처리 확인용). 회원가입(1.2)은 요청한 닉네임으로, 로그인(1.3)·재발급(1.4)은 예시 회원(id 1, 닉네임 "면접왕")으로 액세스 토큰을 만든다. 토큰을 검사하지는 않는다.

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
| 3.1 | 홈 | `GET /home` | S02 · S02-B · S02-C · S02-D, S02-1, S02-L |
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
| 5.8 | 면접 끝내기 | `POST /interview-sessions/{sessionId}/end` | S06, S06-E, S06-F |
| 5.9 | 결과 재생성 | `POST /interview-sessions/{sessionId}/analysis/retry` | S06-1 |
| 5.10 | 실시간 음성 인식 토큰 | `POST /interview-sessions/{sessionId}/stt-token` | S06 |
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

- **201**: 가입 완료. 로그인 상태
- **400 / AGREEMENT_REQUIRED**: 약관 3개 중 하나라도 없음. 가입하지 않음
- **400 / VALIDATION_FAILED**: 이메일·비밀번호·닉네임 조건 불일치. 칸마다 `errors`
- **409 / EMAIL_DUPLICATED**: 사용 중인 이메일(1.1 이후 다른 사람이 먼저 가입한 경우 포함)

#### 1.3 로그인

**화면 — S01 로그인 › [로그인]** → S02 홈(하루 첫 진입이면 S02-1)

자동 로그인 유지(스트릭 유지 목적)를 위해 리프레시 토큰 유효 기간을 길게 둔다(값은 BE 결정). 비밀번호 찾기는 MVP 제외.

- **200**: 이메일·비밀번호 일치
- **401 / LOGIN_FAILED**: 이메일 없음·비밀번호 틀림·탈퇴 회원. 구분 없이 같은 문구

#### 1.4 토큰 재발급

**화면 — 공통. 액세스 토큰 만료 시**

새 액세스·리프레시 토큰을 준다. 쓴 리프레시 토큰은 폐기된다.

- **200**: 유효한 리프레시 토큰
- **401 / REFRESH_TOKEN_INVALID**: 만료·재사용·로그아웃·탈퇴로 폐기됨. 화면은 S01로

#### 1.5 로그아웃

**화면 — C01 프로필 메뉴, S09-1 설정** → 확인 없이 S00

- **204**: 로그아웃. 이미 폐기된 토큰이어도 204

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

**스트릭 규칙**: 연습 면접 = 답변 1개 이상으로 끝난 면접(`ANALYZING`·`COMPLETED`·`FAILED`, `ABORTED` 제외). 연습한 날 = 연습 면접이 있는 날. 스트릭 = 오늘(또는 어제)까지 빠짐없이 이어진 연습일 수, 하루라도 빠지면 0. 뱃지 구간 0 / 1–2 / 3–6 / 7–13 / 14–20 / 21+일.

#### 3.1 홈

**화면 — S02 · S02-B · S02-C · S02-D, S02-1 인트로, S02-L 레벨업**

홈 한 장에 필요한 값을 한 번에 준다. 어떤 홈을 그릴지는 `homeState`로 정한다. 자정까지 남은 시간, 인트로·레벨업 하루 1회 노출은 화면이 처리한다.

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

면접을 만들고 면접 플랜(질문·평가 기준) 생성을 시작한다(사용자에게 비노출). 완료는 WebSocket `PLAN_READY` 또는 5.2로 확인한다.

- **201**: 생성(`status: READY`, `planStatus: GENERATING`)
- **404 / APPLICATION_NOT_FOUND**: 없거나 남의 지원서
- **409 / IDEMPOTENCY_KEY_REUSED**: 같은 키로 다른 본문

#### 5.2 면접 조회

**화면 — S05 [면접 시작] 활성화, S06·S06-B 상단, S06-F 재연결 복구, S06-1 진행**

WebSocket을 놓쳤거나 새로고침했을 때 이 응답으로 화면을 다시 그린다([CONTRIBUTING 7](CONTRIBUTING.md#7-음성websocketai-job-금지사항)). "질문 3 / 5"의 전체 질문 수는 아직 정해지지 않았다(B-3).

- **200**: 본인 면접
- **404 / SESSION_NOT_FOUND**: 없거나 남의 면접

#### 5.3 면접 플랜 재생성

**화면 — S05 장치 점검 › 생성 실패 › [다시 시도]**

- **202**: 재생성 시작. 5.2 형식(`planStatus: GENERATING`)
- **404 / SESSION_NOT_FOUND**
- **409 / PLAN_NOT_FAILED**: `planStatus`가 `FAILED`가 아님

#### 5.4 면접 시작

**화면 — S05 [면접 시작](화상), S05-1 [면접 시작](채팅)**

면접을 시작하고 첫 질문을 준다. 화상은 이 응답 시점에 녹화를 시작한다(6.4 질문 시점의 기준).

채팅은 장치 점검 없이 5.1 직후 S06-B로 바로 넘어간다. 면접관을 띄워 둔 채 `PLAN_READY`(또는 5.2 `planStatus: READY`)를 받으면 화면이 이 API를 자동으로 부른다. 별도 대기 화면은 없다.

- **200**: 시작. 5.2 형식(`status: IN_PROGRESS`, `currentQuestion` = 1번 질문)
- **404 / SESSION_NOT_FOUND**
- **409 / PLAN_NOT_READY**: 플랜 생성 중이거나 실패
- **409 / INVALID_SESSION_STATE**: `READY`가 아님

#### 5.5 지금 질문

**화면 — S06·S06-B 질문 말풍선. `QUESTION_READY`를 놓쳤을 때 복구**

- **200**: 답할 질문 있음
- **202 / QUESTION_GENERATING**: 다음 질문 생성 중. 오류가 아니라 본문은 `{ "code": "QUESTION_GENERATING" }`만. `QUESTION_READY`를 기다린다
- **404 / SESSION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님

질문 음성(TTS) 전달은 보류(B-1).

#### 5.6 답변 음성 업로드 주소

**화면 — S06 화상 › 답변 녹음 시작**

응답은 2.4와 같은 형식. `objectKey`는 5.7 `audioObjectKey`로 보낸다.

- **200**: 발급
- **404 / SESSION_NOT_FOUND** · **QUESTION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: 화상 면접 중이 아님

#### 5.7 답변 제출

**화면 — S06 [답변 완료] 또는 침묵, S06-B [보내기]**

질문 하나에 답변 하나만 낼 수 있다. 화상은 실시간 음성 인식(5.10)의 최종 글과 음성 키를, 채팅은 입력한 글을 보낸다. 음성 파일은 음성 지표 분석·보관용이다. 다음 질문은 `QUESTION_READY` 또는 5.5로 받고, 점수·피드백은 면접 종료 후 채워진다.

- **202**: 접수
- **400 / VALIDATION_FAILED**: `content` 길이 초과(TEXT 1,000자 / VOICE 10,000자), VOICE인데 `audioObjectKey` 없음
- **404 / SESSION_NOT_FOUND** · **QUESTION_NOT_FOUND** · **FILE_NOT_FOUND**(음성 파일 없음)
- **409 / ANSWER_ALREADY_SUBMITTED**: 이미 답변함(다른 키로 재전송)
- **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님

#### 5.8 면접 끝내기

**화면 — 마지막 답변 후 자동, S06-E [끝내기], S06-F [면접 끝내기]**

본문 없음. 답변 1개 이상이면 결과 생성을 시작하고 그날 연습으로 인정한다. 0개면 결과·연습 인정 없이 끝난다.

- **202**: 답변 ≥1. 5.2 형식(`status: ANALYZING`). 완료는 `SESSION_STATUS_CHANGED` 또는 5.2
- **200**: 답변 0. 5.2 형식(`status: ABORTED`). 화면은 홈으로
- **404 / SESSION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: `IN_PROGRESS`가 아님

#### 5.9 결과 재생성

**화면 — S06-1 › 실패 › [다시 시도]**

- **202**: 재생성 시작. 5.2 형식(`status: ANALYZING`)
- **404 / SESSION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: `FAILED`가 아님

#### 5.10 실시간 음성 인식 토큰

**화면 — S06 화상 › 답변 듣기 시작, 토큰 만료 전 재발급**

브라우저가 STT 회사에 직접 스트리밍 연결할 1회용 임시 토큰을 준다. API 키는 서버에만 두고, 음성은 BE·WebSocket을 거치지 않는다([CONTRIBUTING 7](CONTRIBUTING.md#7-음성websocketai-job-금지사항)). 화면은 받아 적는 글을 S06 자막으로 보여 주고 최종 글을 5.7 `content`로 보낸다. STT 회사는 1회용 토큰을 지원하는 일레븐랩스·Soniox 중 미정(B-2).

- **200**: 발급
- **404 / SESSION_NOT_FOUND**
- **409 / INVALID_SESSION_STATE**: 화상 면접 중이 아님
- **503 / STT_UNAVAILABLE**: STT 회사 토큰 발급 실패. 잠시 뒤 재시도

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

면접 1회 결과. 화면은 점수 대신 좋아요·보통·아쉬워요로 보여 준다. 반응 썸네일은 면접관별 고정 이미지라 API 필드가 없다. 채팅 면접은 같은 형식에 `mode: CHAT`, `speechMetrics: null`. 채팅도 기준 4개 점수가 모두 나온다(전달력은 답변 글로 판단).

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

화면 표시: S08 "오늘 나아진 점"은 `delta` > 0인 기준. 자소서 검증(`COVER_LETTER`)은 `delta` 없이 `comment`만(충돌 0개면 "막힘 없이 통과"). S08-C는 `delta` 대신 `grade`로 기준점. 설문 유도(S08-B, 3·7·21일째)는 화면이 `streakOnDate`로 판단해 외부 구글폼을 연다.

- **200**: 그날 결과가 있음
- **404 / GROWTH_REVIEW_NOT_FOUND**: 그날 연습 기록 또는 결과가 없음

#### 7.2 최근 성장 리뷰

**화면 — S02 홈 › 최근 성장 리뷰**(3.1에도 포함)

페이지 목록, 최근 날짜 순.

- **200**: 항상. 없으면 빈 배열

## 3. 실시간 (WebSocket)

Swagger에는 표시되지 않는다.

`/ws/interview-sessions/{sessionId}`. 연결 직후 첫 메시지로 액세스 토큰 전송(B-11). 공통 필드 `type`, `sessionId`, `sequence`(보내는 쪽마다 1씩 증가), `sentAt`. 놓치면 REST로 복구.

| type | 방향 | 언제 | 본문 | 복구 |
|---|---|---|---|---|
| `PLAN_READY` · `PLAN_FAILED` | 서버→화면 | 플랜 생성 완료 · 실패 | 없음 | 면접 조회 |
| `SESSION_STATUS_CHANGED` | 서버→화면 | `status`·`planProgress`·`analysisStep` 변경 | 바뀐 값 | 면접 조회 |
| `QUESTION_READY` | 서버→화면 | 다음 질문 준비 | `question: { id, seq, content }` | 지금 질문 |
| `REACTION` | 서버→화면 | 면접관 반응(반응 로직 모듈 판단) | `reaction` (아래 두 케이스) | 없음 |
| `LISTENING_STARTED` | 화면→서버 | 답변 듣기 시작 | `questionId` | - |
| `ANSWER_COMPLETED` | 화면→서버 | [답변 완료] (반응 중지) | `questionId` | - |

```json
{ "type": "QUESTION_READY", "sessionId": 55, "sequence": 12, "sentAt": "2026-10-15T12:10:05+09:00",
  "question": { "id": 304, "seq": 4, "content": "백엔드 직무에 지원한 이유는?" } }
{ "type": "SESSION_STATUS_CHANGED", "sessionId": 55, "sequence": 41, "sentAt": "2026-10-15T12:18:06+09:00",
  "status": "ANALYZING", "planProgress": null, "analysisStep": "SCORING" }
```

### `REACTION` — 면접관 방식별 두 케이스

반응 판단·전달(반응 로직 모듈 → BE)은 같고, 화면이 값을 쓰는 방법이 다르다. 필드는 면접관 표현 모듈 반응 이벤트 계약([`interviewer-avatar/architecture.md`](../박연수/interviewer-avatar/architecture.md) 2장)을 따른다.

| | 케이스 1. 코드로 변형 (후보 2개) | 케이스 2. 표정별 이미지 (후보 1개) |
|---|---|---|
| 동작 | BE 값에 따라 얼굴을 코드로 연속 변형 | 표정별로 저장한 이미지 중 하나를 표시 |
| 쓰는 `reaction.type` | `state` · `expression` · `gesture` · `attitude` | `state` · `expression` |
| `intensity`(세기) · `attitude`(태도) · `gesture`(동작) | 사용 | 무시 |
| `durationMs` | 순간 표정 유지 시간 | 이미지 표시 시간. 끝나면 `state` 이미지로 복귀 |

| 값 | 케이스 1 | 케이스 2 |
|---|---|---|
| `state`: `idle` · `listening` · `thinking` · `speaking` | 자세·시선·입 움직임으로 표현 | 상태별 기본 이미지 |
| `expression`: `smile` · `frown` · `smirk` | 세기에 따라 연속 변형 | 표정별 이미지 |
| `gesture`: `small_nod` · `nod` · `tilt` | 끄덕·갸웃 동작 | 무시 |
| `attitude`: `interest` · `trust` · `tension` (0~1) | 표정이 서서히 바뀜 | 무시 |

```json
// 케이스 1
{ "type": "REACTION", "sessionId": 55, "sequence": 31, "sentAt": "2026-10-15T12:07:02+09:00",
  "reaction": { "type": "expression", "expression": "smile", "intensity": 0.6, "durationMs": 1200, "ttlMs": 1500, "source": "server" } }
// 케이스 2
{ "type": "REACTION", "sessionId": 55, "sequence": 31, "sentAt": "2026-10-15T12:07:02+09:00",
  "reaction": { "type": "expression", "expression": "smile", "durationMs": 1200, "ttlMs": 1500, "source": "server" } }
```

채팅 면접은 음성이 없어 기본값(무표정, `state`만). 공통: `ttlMs`가 지났거나 `ANSWER_COMPLETED` 뒤 도착한 반응, 정의되지 않은 값은 버린다. 반응 로직 모듈은 면접관 방식을 몰라도 된다(케이스 2는 쓰지 않는 필드를 무시). 실시간 답변 자막은 브라우저가 STT 회사에서 직접 받는다(5.10).

## 4. 오류 코드

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
| `INVALID_SESSION_STATE` | 409 | 5.4~5.10, 6.1 |
| `PLAN_NOT_READY` · `PLAN_NOT_FAILED` | 409 | 5.4 · 5.3 |
| `ANSWER_ALREADY_SUBMITTED` | 409 | 5.7 |
| `STT_UNAVAILABLE` | 503 | 5.10 |
| `RECORDING_ALREADY_EXISTS` | 409 | 6.2 |
| `RESULT_NOT_READY` · `NO_RESULT` | 409 | 6.3, 6.4 |
| `GROWTH_REVIEW_NOT_FOUND` | 404 | 7.1 |
| `QUESTION_GENERATING` | 202(오류 아님) | 5.5 |

## 5. 보류 · 확인 필요 (B)

| # | 내용 | 영향 | 담당 |
|---|---|---|---|
| B-1 | 질문 음성(TTS) 전달: TTS 회사(일레븐랩스·타입캐스트). 1회용 토큰 지원 시 5.10과 같은 방식 | 5.4, 5.5, `QUESTION_READY` | 보류 |
| B-2 | STT 회사: 일레븐랩스 · Soniox 중 미정 | 5.10 | BE |
| B-3 | 면접 전체 질문 수("질문 3 / 5"). 고정이면 상수, 바뀌면 컬럼 필요 | 5.2, 5.7 | 면접 AI 모듈 |
| B-4 | 점수 → 좋아요·보통·아쉬워요 경계값 | 6.3, 6.4, 7.1 | 협의 |
| B-5 | 오늘 완료 기준(현재: 답변 1개 이상인 면접 종료). 성장 리뷰까지 봐야 완료인지 | 3.1, 5.8 | 화면 |
| B-6 | 탈퇴 시 삭제 범위, 녹화 보관 기간 | 2.7, 6.x | 약관 |
| B-7 | 설문 노출·참여, 재방문 지표(D1·D3·D7) 저장 | 7.1 | 이벤트 로깅 |
| B-8 | 면접관별 반응 케이스(코드 변형 / 표정 이미지), 케이스 2 이미지 목록 | `REACTION` | 면접관 표현 모듈 |
| B-9 | 면접 플랜(예상 질문·평가 기준) 저장 위치. 평가 기준이 고정 4개면 저장 불필요 | 5.1~5.4 | 면접 AI 모듈 |
| B-10 | 자소서 검증: 충돌 1개당 차감 점수, "명확한 충돌" 판단 기준 | 6.3, 7.1 | 면접 AI 모듈 |
| B-11 | WebSocket 인증 방식(첫 메시지 토큰 / 쿠키 / 1회용 연결 티켓) | WebSocket | BE |
