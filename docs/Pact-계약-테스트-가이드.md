# Pact 계약 테스트 가이드

FE와 BE가 주고받는 요청 · 응답을 Pact로 묶는 방법을 정한다. 계약 테스트를 새로 쓰거나 고칠 때 이 문서를 따른다. CI 잡 구성은 [CONTRIBUTING 12.4](CONTRIBUTING.md#124-자동-검사배포ci)에 있다.

- 근거는 세 가지로 나눠 적는다.
  - **[공식]** Pact 공식 문서의 안내다. 링크를 함께 단다.
  - **[팀]** 담당자와 합의한 결정이다.
  - **[구현]** 이번 구현에서 직접 겪고 확인한 사실이다.
- 바꾸고 싶은 규칙이 있으면 이 문서부터 고친다. 그 뒤에 코드를 바꾼다.

## 목차

1. [범위와 흐름](#1-범위와-흐름)
2. [소비자(FE) 작성 규칙](#2-소비자fe-작성-규칙)
3. [제공자(BE) 검증 규칙](#3-제공자be-검증-규칙)
4. [CI와 계약 파일](#4-ci와-계약-파일)
5. [Bad Case](#5-bad-case)
6. [MR 전 Checklist](#6-mr-전-checklist)

## 1. 범위와 흐름

| 구분 | 내용 |
| --- | --- |
| 소비자 | FE(`a301-frontend`). `frontend/src/lib/<영역>/*.pact.test.ts`가 계약을 만든다 |
| 제공자 | BE(`a301-backend`). `backend/src/test/java/com/ssafy/a301/contract/FrontendContractTest.java`가 실제로 띄운 BE로 검증한다 |
| 대상 아님 | mock 서버, AI 서버 **[팀]** |
| 도구 | pact-js 17(`PactV4`) · pact-jvm JUnit 5(4.7) |

```
FE 테스트가 FE 함수 호출 → Pact 가짜 서버가 요청 기록 · 응답 → frontend/pacts/*.json 생성
                                                          ↓ (CI 결과물로 전달)
BE contractTest가 상황(given) 준비 → 기록된 요청을 실제 BE에 재생 → 응답이 계약과 맞는지 비교
```

로컬에서는 아래 순서로 실행한다. BE 검증에는 PostgreSQL과 Redis가 필요하다.

```bash
cd frontend && npm run test:pact
```

```bash
cd backend && ./gradlew contractTest
```

## 2. 소비자(FE) 작성 규칙

### 2.1 실제 FE 함수를 부른다

- 상호작용마다 화면이 쓰는 조회 · 서버 액션 함수를 그대로 부른다. axios나 fetch를 테스트에서 직접 부르지 않는다. **[공식]** [Consumer Tests](https://docs.pact.io/consumer) · [pact-js Consumer](https://docs.pact.io/implementation_guides/javascript/docs/consumer)
- Next 런타임에만 있는 것만 가짜로 바꾼다. `next/headers`(쿠키), `next/navigation`(`redirect`), `next/cache`(`refresh`)가 그 대상이다(`src/test/pact-setup.ts`). **[구현]**
- 로그인 상태는 `asMember`, 비로그인 상태는 `asGuest`로 감싸 부른다(`src/test/pact.ts`).

### 2.2 무엇을 계약에 넣는가

공식 기준은 하나다. 이 상호작용을 빼면 FE를 깨뜨리는 BE 변경을 놓치는가? 놓친다면 넣고, 아니면 뺀다. **[공식]** [Consumer Tests](https://docs.pact.io/consumer)

| 대상 | 규칙 | 근거 |
| --- | --- | --- |
| API | FE가 실제로 부르는 API만 넣는다 | **[공식]** 소비자가 쓰는 것만 검증 |
| 응답 필드 | FE 코드(함수 → 화면)가 읽는 필드만 넣는다. 읽지 않는 필드(`createdAt` 등)는 뺀다 | **[공식]** 같음 |
| 오류 | API마다 FE 처리 분기(이동 · 다시 그리기 · 화면 상태 · 칸 오류)마다 예시 하나를 넣는다 | **[팀]** |
| 서버 문구만 보여 주는 오류 | 그 API에 기본 분기를 지나는 다른 오류 예시가 없을 때만 하나 넣는다. `redirect`로 끝나는 분기는 기본 분기를 대신하지 못한다 | **[팀]** |
| `detail` | FE가 화면에 보여 줄 때만 넣는다 | **[팀]** |
| FE가 결과를 버리는 오류 | 넣지 않는다 | **[팀]** |
| 여러 요청이 이어지는 흐름 | 넣지 않는다. 상호작용 하나는 요청 · 응답 한 쌍이라 담을 수 없다(예: 토큰 만료 → 재발급 → 재시도) | **[구현]** |
| 값마다 다른 예시 | 화면이 다르게 그리는 상태(예: 5.2 면접 상태 · 3.1 홈 상태)는 분기마다 예시 하나를 둔다. 같은 분기 안에서 값(null · true/false · enum)만 다른 예시는 늘리지 않는다 | **[공식]** [Contract tests vs functional tests](https://docs.pact.io/consumer/contract_tests_not_functional_tests) |
| 검증 실패 이유 | 실패하는 **모양**(400 · `code` · `errors[].field`)만 넣는다. 실패하는 **이유**(규칙 하나하나)는 넣지 않는다 | **[공식]** 같음 |

### 2.3 기대 값은 Swagger 예시에서 가져온다

- 응답 · 오류 예시 값은 웹 Swagger의 해당 API 예시를 FE 테스트에 옮긴다. **[팀]**
- Swagger에 오류 예시가 없는 API에는 오류 상호작용을 만들지 않는다. **[팀]**
- 예시 값은 고정한다. 실행할 때마다 값이 바뀌는 데이터(무작위 UUID · 현재 시각)를 넣지 않는다. **[공식]** [Consumer Tests](https://docs.pact.io/consumer)
- 실제 토큰 · 비밀번호 · 개인정보를 넣지 않는다. **[공식]** 같음

### 2.4 매칭: 요청은 정확히, 응답은 필드마다 정한다

공식 원칙은 Postel의 법칙이다. 보내는 것(요청)은 엄격하게, 받는 것(응답)은 느슨하게 맞춘다. 정확히 비교할지 느슨하게 비교할지는 필드마다 정한다. **[공식]** [Matching](https://docs.pact.io/getting_started/matching) · [Consumer Tests](https://docs.pact.io/consumer)

| 대상 | 쓰는 도구(`src/test/pact.ts`) | 언제 |
| --- | --- | --- |
| 요청 본문 · 쿼리 · 헤더 | 값 그대로 | 항상 정확히 비교한다 |
| BE 상황이 만드는 값(id · 토큰 · 날짜 · 이메일) | `providerValue` · `providerPath` · `sessionPath` · `bearer` | 요청에 넣을 값을 상황(`given`)이 돌려준 값으로 바꾼다. **[공식]** [pact-js Matching](https://docs.pact.io/implementation_guides/javascript/docs/matching) `fromProviderState` |
| 응답에서 읽기만 하는 필드 | `shape(example)`(→ `like`) | 타입만 비교한다 |
| 응답에서 FE가 값으로 분기하는 필드 | `shape(example, "필드", …)`(→ `equal`) | 상태값 · 첫 연습 여부 · null 여부 · 페이지 계산 · 오류 `code` · `errors[].field` |
| 목록마다 값이 다른 enum(라벨 · 색) | `oneOf(values, example)`(→ `regex`) | FE가 아는 값 중 하나인지만 본다 |
| 배열 | `eachLike` | 요소 하나 이상, 각 요소의 모양을 본다 |
| 비어 있어도 정상인 배열 | `atLeastLike(example, 0)` | BE가 빈 배열을 정상으로 줄 수 있으면 쓴다(예: 4.7 회사 `aliases`). `eachLike`는 빈 배열을 실패로 본다. 예시는 하나 그대로 둔다 |
| 오류 응답 | `problem(b, { code, detail?, errors? }, { generic? })` | `application/problem+json`. `generic`이면 `code`도 타입만 비교한다 |

- `like` · `eachLike`의 타입 비교는 안쪽 값 전부로 이어진다. 안쪽에 정확히 비교할 값이 있으면 `equal`로 다시 감싼다. `shape`과 `problem`은 이 처리를 이미 한다. **[공식]** [pact-js Matching](https://docs.pact.io/implementation_guides/javascript/docs/matching)
- 값으로 비교하는 필드는 BE 상황이 언제나 같은 값을 만들어야 한다(예: 새 회원의 문의 1건 → `totalPages` 1). **[구현]**

### 2.5 이름 · 구조

- `uponReceiving`에는 API 번호와 FE의 의도를 쓴다. 이름이 겹치지 않게 한다. 예: `"5.8 답 없이 면접 끝내기"` **[공식]** [Consumer Tests](https://docs.pact.io/consumer)
- 테스트 하나에 상호작용 하나를 둔다. **[공식]** 같음
- 단언은 FE 함수의 반환값으로 계약이 맞는지만 본다. 로깅 같은 부수 효과는 확인하지 않는다. **[공식]** 같음
- import 아래에 기준 Swagger 번호를 적는다. 예: `// 기준: Swagger 5.1~5.8 · 5.14 면접 진행 예시`

### 2.6 실행 설정

- 실행 전에 계약 폴더(`frontend/pacts`)를 비운다. 지운 상호작용이 파일에 남지 않게 하려는 것이다. 이 일은 `src/test/pact-global-setup.ts`가 한다. **[공식]** [pact-js Consumer](https://docs.pact.io/implementation_guides/javascript/docs/consumer)
- Pact 객체는 스레드 안전하지 않다. **[공식]** 같음
  - 그래서 계약 테스트 파일은 하나씩 순서대로 돌린다. `vitest.pact.config.mts`의 `fileParallelism: false`가 이 설정이다. **[구현]**
- 일반 `vitest run`은 `*.pact.test.ts`를 빼고 돈다. 계약 테스트는 `npm run test:pact`로만 돌린다.

## 3. 제공자(BE) 검증 규칙

### 3.1 로컬로 띄운 실제 BE에 검증한다

- 검증 대상은 배포된 서버가 아니다. 로컬로 띄운 BE에 검증한다(`@SpringBootTest(RANDOM_PORT)` + `HttpTestTarget`). **[공식]** [Verifying Pacts](https://docs.pact.io/provider)
- 가짜로 바꾸는 것은 BE 밖으로 나가는 연결뿐이다. BE 코드 자체는 가짜로 바꾸지 않는다. **[공식]** 같음
  - 지금 바꾸는 것: `CoverLetterCheckQueue` · `AiJobQueue` · `InterviewRoom`(LiveKit) · `S3FileStorage` · `JavaMailSender`(비밀번호 찾기 메일) · `KakaoMessageClient`(연습 알림 카카오 동의, 여기까지 `@MockitoBean`)
  - `KakaoLoginClient`(카카오 로그인 · 계정 연결)는 `@MockitoSpyBean`으로 감싸 카카오에 인가 코드를 확인하는 `fetchProfile`만 바꾼다. 로그인 서비스가 제공자 목록을 만들 때 `provider()`의 실제 값이 필요해서다. **[구현]**
- DB는 로컬 PostgreSQL · Redis를 그대로 쓴다. **[공식]** 같음(가벼운 로컬 DB는 써도 된다)

### 3.2 상황(`@State`)

- 상황 이름은 FE 계약의 `given`과 글자까지 같아야 한다. **[공식]** [Provider states](https://docs.pact.io/getting_started/provider_states)
- 매개변수는 `Map`으로 받는다. 요청에 넣을 값(id · 토큰 · 날짜)은 `Map`으로 돌려준다. **[공식]** [JVM Provider JUnit](https://docs.pact.io/implementation_guides/jvm/provider/junit)
- 데이터는 BE 서비스(비즈니스 로직)를 불러 만든다. 저장소 · SQL로 직접 넣지 않는다. **[팀]**
- 서비스로 만들 수 없는 경우만 예외로 하고, 메서드 주석에 이유를 적는다. 지금 예외는 아래 다섯 가지다.

| 상황 | 방법 | 이유 |
| --- | --- | --- |
| 만료된 토큰 | `JwtEncoder`로 직접 서명 | 서비스는 언제나 지금부터 유효한 토큰만 발급한다 |
| 지난날 본 면접(어제 · 그저께) | 서비스로 만든 뒤 날짜만 SQL로 그 일수만큼 앞당김 | 서비스는 언제나 오늘 날짜로 저장한다 |
| 관리자 | repository로 생성 | 관리자 가입 서비스가 없다 |
| 다른 요청에 쓴 멱등 키 | `IdempotencyStore`에 직접 기록 | 멱등 처리는 HTTP 인터셉터에만 있다 |
| 비밀번호 재설정 링크 | `PasswordResetTokenStore.issue`로 token 생성 | 서비스(1.8)는 token을 메일로만 보내고 돌려주지 않는다 |

### 3.3 상호작용마다 격리한다

- 상호작용은 하나씩 따로 검증한다. 앞 상호작용이 만든 데이터에 기대지 않는다. **[공식]** [Provider states](https://docs.pact.io/getting_started/provider_states)
- 상호작용이 끝날 때마다 `@AfterEach`가 그 상호작용이 만든 데이터를 지운다(`ContractData`). **[구현]**
  - 재생된 요청이 만든 데이터도 지운다(회원가입이 만든 회원, 비회원 문의).
- 같은 로컬 DB를 쓰는 다른 테스트 · 개발 데이터를 지우지 않게, 지울 범위를 좁힌다(예: 비회원 문의는 `GUEST_EMAIL` + 상호작용 시작 시각 이후). **[구현]**
- `ContractData`는 PostgreSQL 행만 지운다. Redis의 멱등 키 · 면접 진행 키 · 로그인 잠금 키(`login-fail:`, 15분) · 비밀번호 재설정 키(`password-reset:` 30분 · `password-reset-wait:` 30초) · 소셜 가입 토큰(`social-signup:` 10분)은 지우지 않고 만료 시간(TTL)이 지나면 사라진다. 상황마다 회원 · 면접 id · 이메일이 새로 생겨 다음 상호작용과 겹치지 않는다. 그러니 이전 실행의 Redis 값에 기대는 계약은 만들지 않는다. **[구현]**

## 4. CI와 계약 파일

- 계약 파일(`frontend/pacts/`)은 커밋하지 않는다(`.gitignore`). **[팀]**
  - 같은 파이프라인에서 `fe-pact` 결과물로 `be-pact`에 넘긴다. Pact Broker는 쓰지 않는다. **[팀]**
- 두 잡은 MR에서만 돈다. 아래 경로가 바뀐 MR이 대상이다(`.pact-rules`).
  - `frontend/src/lib/**`, `frontend/src/types/api/**`
  - `frontend/src/test/pact*.ts`, `frontend/vitest.pact.config.mts`
  - `frontend/package.json`, `frontend/package-lock.json`
  - `backend/**`, `.gitlab-ci.yml`
- 계약 검증은 다른 테스트와 같은 파이프라인 `test` 단계에서 돈다. **[공식]** [Verifying Pacts](https://docs.pact.io/provider)
  - 잡은 따로 둔다. `be-test`는 `contract` 태그를 빼고 돌고, `be-pact`가 `fe-pact`의 계약 파일을 받아 `contractTest`만 돌린다. **[구현]**
- `contractTest`는 `../frontend/pacts`를 Gradle 입력으로 선언한다. 그래서 계약이 바뀌면 빌드 캐시의 지난 결과를 쓰지 않고 다시 검증한다. **[구현]**

## 5. Bad Case

이번 구현에서 실제로 겪었거나 검수에서 걸린 경우다.

| Bad Case | 증상 | 올바른 방법 |
| --- | --- | --- |
| 응답 객체를 `like` 하나로 통째로 감쌌다 | 안쪽의 상태값 · `errors[].field`까지 타입 비교로 바뀌어, BE가 값을 바꿔도 통과한다 | `shape(example, "분기 필드")`. 안쪽 정확 값은 `equal` **[공식]** |
| 오류 응답에 `Content-Type`을 정하지 않았다 | BE의 `application/problem+json`과 계약의 `application/json`이 달라 실패한다 | `problem()` 도우미를 쓴다. 헤더를 먼저 정한 뒤 `jsonBody` **[구현]** |
| 응답에 `body()`를 썼다 | 본문을 바이너리로 비교해 매처가 듣지 않는다 | `jsonBody()` **[구현]** |
| 상태값 · null · true/false마다 예시를 늘렸다 | BE가 규칙만 조금 바꿔도 깨지는 과한 계약이 되고, 테스트 수가 불어난다 | 분기 필드는 값으로 비교만 하고, 예시는 분기마다 하나 **[공식]** |
| 입력 검증 규칙마다 400 예시를 넣었다 | BE 비즈니스 규칙을 계약이 다시 검사한다 | 실패 모양(`code` · `errors[].field`) 하나만 **[공식]** |
| FE가 읽지 않는 필드 · `detail`을 넣었다 | BE가 쓰지 않는 필드를 바꿔도 계약이 깨진다 | 함수 → 화면까지 따라가 읽는 것만 넣는다 **[공식]** |
| 같은 기본 분기 오류를 API마다 여러 개 넣었다(예: 5.4 · 5.7 · 5.8의 멱등 키 재사용) | 같은 FE 분기를 중복 검사한다 | 그 API에 기본 분기를 지나는 예시가 하나 있으면 뺀다 **[팀]** |
| 테스트에서 axios를 직접 불렀다 | FE 함수가 실제로 보내는 요청과 계약이 어긋날 수 있다 | FE 조회 · 서버 액션 함수를 부른다 **[공식]** |
| mock 서버로 검증했다 | mock은 실제 BE와 다를 수 있어 어긋남을 놓친다 | 실제 BE로만 검증한다 **[팀]** |
| 상황 데이터를 지우지 않았다 | 비회원 문의가 로컬 DB에 쌓여 다음 실행 · 다른 테스트에 섞였다 | 상호작용마다 `@AfterEach`로 정리한다 **[구현]** |
| 상황마다 값이 달라지는 목록 enum을 `equal`로 고정했다 | 데이터 순서 · 개수가 바뀌면 실패한다 | `oneOf` **[구현]** |
| 계약 파일을 Gradle 입력으로 선언하지 않았다 | 계약이 바뀌어도 캐시된 지난 결과로 통과한다 | `inputs.dir(../frontend/pacts)` **[구현]** |
| 429에 `Retry-After`(900초)를 주는 응답을 검증했다 | 검증 클라이언트가 그만큼 기다렸다 다시 보내 잠금이 풀린 뒤의 200과 비교했다(검증이 15분 걸리고 실패) | `HttpTestTarget`에 다시 보내지 않는 클라이언트(`disableAutomaticRetries`)를 넘긴다 **[구현]** |
| 만료 → 재발급 → 재시도를 한 상호작용으로 만들려 했다 | 상호작용 하나에는 요청 · 응답 한 쌍만 담을 수 있다 | 계약에서 빼고 단위 테스트로 검사한다 **[구현]** |

## 6. MR 전 Checklist

- [ ] 새로 부르는 API · 새로 읽는 필드를 계약에 넣었는가? 더는 읽지 않는 필드를 뺐는가?
- [ ] FE 오류 처리 분기를 바꿨다면 그에 맞게 오류 상호작용을 더하거나 뺐는가?
- [ ] 값으로 분기하는 필드만 `shape`의 exact · `equal` · `oneOf`로 비교했는가?
- [ ] 예시 값을 웹 Swagger 예시에서 가져왔는가?
- [ ] 새 `given`을 썼다면 BE `@State`를 서비스로 만들었는가? 예외라면 주석에 이유를 적었는가?
- [ ] 상황이 만든 데이터를 `ContractData`가 지우는가?
- [ ] `npm run test:pact` 뒤 `./gradlew contractTest`가 로컬에서 통과하는가?
