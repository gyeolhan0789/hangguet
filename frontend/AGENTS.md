<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 한국어로 답변한다

## 구현은 Mock · Figma · 정의된 타입을 기준으로 하고 출처를 적는다

- 모든 구현은 아래 세 가지를 기준으로 한다. 셋과 다르게 만들지 않는다.
  - Mock: **웹에 배포된 mock 서버가 API의 유일한 기준(source of truth)이다.** Swagger(`https://hangguet.yobistory.com/mock/be/swagger-ui/index.html`, JSON은 `https://hangguet.yobistory.com/mock/be/v3/api-docs`)와 그 서버의 실제 응답만 본다.
    - 레포의 `mock/` 폴더 코드와 `docs/`(API-명세 · 연습기록-API 등) 문서는 참고하지 않는다. 배포본과 다를 수 있다.
    - 코드 주석에 적힌 근거도 믿지 말고, 확인할 때마다 웹 Swagger와 대조한다.
  - Figma: 와이어프레임 파일(`https://www.figma.com/design/MhbhCsxX6tsubO3Hku4TjH`)의 해당 화면
  - 타입: `src/types/api`에 정의된 요청 · 응답 타입. API 데이터의 타입을 새로 만들지 않고 여기서 가져온다
- 단일 모듈(컴포넌트 · 서버 액션 · 조회 함수 · 스키마 등) 하나를 구현할 때마다, 그 모듈이 따르는 설계(Figma 화면 · 웹 mock Swagger의 해당 API · 타입)를 먼저 확인한다.
- 확인한 설계는 모듈에 출처로 적는다. 예: `// 기준: Figma S03 지원서 · Swagger 4.1 지원서 작성 · ApplicationCreateRequest`

## 설치된 라이브러리를 반드시 쓴다

아래 표에 있는 일은 직접 구현하지 말고, 해당 라이브러리를 반드시 쓴다. 같은 일을 하는 다른 라이브러리도 새로 추가하지 않는다.

| 용도 | 라이브러리 | 쓰는 방법 |
| --- | --- | --- |
| API 호출 | `axios` | `fetch`나 새 인스턴스를 만들지 않고 `@/lib/api`의 `api`를 쓴다. 주소는 문자열로 직접 쓰지 않고 `endpoints`에서 꺼낸다 |
| 클라이언트 상태 | `zustand` | 여러 컴포넌트가 나눠 쓰는 상태는 Context나 직접 만든 store 대신 zustand store로 만든다. store는 `src/stores/`에 둔다 (예: 로그인한 회원은 `useUserStore`) |
| 애니메이션 | `motion` | 등장·전환·인터랙션 애니메이션은 `motion/react`로 만든다 |
| 스타일 | `tailwindcss` | 스타일은 Tailwind 유틸리티 클래스로 작성한다. 인라인 `style`과 새 CSS 파일은 Tailwind로 표현할 수 없을 때만 쓴다 |
| 폼 | `react-hook-form` | 입력 폼은 `useState`로 값을 직접 관리하지 않고 `useForm`으로 만든다 |
| 검증 | `zod` + `@hookform/resolvers` | 폼 검증 규칙은 zod 스키마로 정의하고 `zodResolver`로 연결한다. 타입은 `z.infer`로 뽑는다 |
| 차트 | `recharts` | 차트·그래프는 SVG나 canvas로 직접 그리지 않고 recharts로 만든다 |

## API 호출은 서버에서만 한다

- 백엔드 API는 서버 컴포넌트에서 호출한다. 조회는 서버 컴포넌트, 변경(POST·PATCH·PUT·DELETE)은 서버 액션(`"use server"`)에서 한다.
- 클라이언트 컴포넌트(`"use client"`)에서는 `@/lib/api`를 불러오지 않는다. 필요한 데이터는 서버 컴포넌트가 받아서 props로 넘기고, 변경은 서버 액션을 호출한다.
- 토큰은 httpOnly 쿠키에만 있다. 로그인·로그아웃 서버 액션은 `setAuthCookies`·`clearAuthCookies`로 쿠키를 다룬다. 토큰을 store·localStorage·props에 두지 않는다.
- 액세스 토큰 재발급은 `src/proxy.ts`가 맡는다. 화면 코드에서 직접 재발급하지 않는다.
- `api`는 쿠키를 읽으므로, 호출하는 서버 컴포넌트는 `<Suspense>` 안에 둔다(`cacheComponents` 사용 중).
- 예외: Presigned URL로 S3에 올리고 받는 파일, STT 회사로 보내는 실시간 음성은 브라우저가 직접 보낸다(웹 Swagger 2.4 · 5.10 · 5.12 · 6.1). 그 주소·토큰을 받는 API 호출 자체는 서버에서 한다.

## 화면 하나를 만드는 작업 순서

따로 시키지 않아도 화면(또는 기능) 하나는 아래 순서를 끝까지 지킨다. 단계를 빼거나 순서를 바꾸지 않는다.

1. **범위**: 요청한 화면만 본다. 다른 화면 · 후속 기능은 묻지도 만들지도 않는다.
2. **설계 확인**: 아래를 모두 직접 확인한다. 서브에이전트는 맥락 없이 대조해야 하는 검수(5 · 7단계)에만 쓰고, 조사는 맡기지 않는다.
   - Figma: 해당 프레임(라이트 · 다크), 기획 메모 · 모션 메모(`get_design_context`)
   - Mock: 웹에 배포된 mock 서버의 Swagger(경로 · 파라미터 · 스키마 · 설명 · 예시)와 실제 응답. 레포의 `mock/` 코드 · `docs/` 문서는 보지 않는다
   - 타입: `src/types/api`
3. **계획 보고 · 빈칸 질문**: 구현 전에 계획을 짧게 보고한다. 설계에 없는 동작 · 문구 · 이동 · 상태 화면은 만들어 넣지 않는다. 빈칸 목록을 기본안과 함께 먼저 묻고, 답을 받은 뒤 구현한다.
4. **구현**
   - 기존 컴포넌트 · 토큰 · 자산을 먼저 찾아 다시 쓴다.
   - Figma 자산은 `public/<화면>/`에 내려받는다. 같은 파일이 이미 있으면 그것을 쓴다.
   - 모듈마다 출처를 적는다(위 '구현은 Mock · Figma · 정의된 타입을 기준으로' 참고).
   - 방식을 고를 일이 있으면 웹에서 모범 사례를 찾아본 뒤 정한다.
5. **설계 준수 검수(서브에이전트)**: 구현이 Mock · Figma · 타입을 완벽하게 지켰는지 서브에이전트가 줄 단위로 대조한다. 대조할 것은 문구, 크기 · 간격 · 색 토큰, 응답 코드별 처리, 필드 사용이다. 나온 결함은 모두 고친다.
6. **테스트 작성**
   - 단위 · 컴포넌트 테스트는 Vitest로 쓴다.
   - E2E는 Playwright로 쓴다.
   - 시간이나 확률에 기대 통과하는 테스트는 금지한다. 시간은 가짜 타이머 · Playwright Clock으로 직접 진행하고, mock은 "몇 번째 요청인가" 대신 테스트가 바꾸는 값을 돌려준다.
   - 이 단계에서는 테스트를 돌리지 않는다. 검수(7단계)로 고친 뒤 최종 검사(8단계)에서 처음 돌린다.
7. **테스트 검수(서브에이전트)**: 서브에이전트가 테스트 모범 사례를 웹에서 먼저 조사한 뒤 아래를 검수한다. 나온 결함은 모두 고친다(돌리지 않고 코드로 검수한다).
   - 테스트 유형별 목적에 맞는가
   - 목킹 등 의존성을 테스트마다 제대로 분리했는가
   - 조건이 합리적인가(시간 · 확률 의존 금지)
8. **최종 검사**: 아래를 모두 통과시킨다.
   - `npx tsc --noEmit` · `npx eslint .` · `npx prettier --check .`
   - `npx vitest run`과 `npx vitest run --sequence.shuffle`
   - E2E: `NEXT_TEST_PROXY=1 npm run build` 뒤 `NEXT_TEST_PROXY=1 npx next start -p 3100`을 띄우고 이번에 바꾼 화면의 spec 파일 단위로 실행한다(`npx playwright test e2e/<파일>.spec.ts --workers=1`). 전체 스위트를 한 번에 돌리지 않는다(병렬 부하로 S05 · S06 테스트가 실패한다). 끝나면 서버를 끈다.
   - 브라우저로 실제 화면을 연다(라이트 · 다크 · 모바일 폭). 설계와 다른 곳이 없는지 눈으로 확인한다.
9. **보고**: 한국어로 짧게 보고한다. 바뀐 것, 검사 결과, 남은 것 · 정해야 할 것을 적는다.
   - 커밋 · 푸시 · 브랜치는 시킬 때만 한다.
   - 커밋 메시지는 `git log` 형식(`타입(범위): 요약 [이슈 키]` + 목록)에 맞춰 먼저 제안한다.
