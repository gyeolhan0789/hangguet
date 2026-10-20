<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 한국어로 답변한다

## 구현은 Mock · Figma · 정의된 타입을 기준으로 하고 출처를 적는다

- 모든 구현은 아래 세 가지를 기준으로 한다. 셋과 다르게 만들지 않는다.
  - Mock: mock 서버 Swagger(`https://hangguet.yobistory.com/mock/be/swagger-ui/index.html`)
  - Figma: 와이어프레임 파일(`https://www.figma.com/design/MhbhCsxX6tsubO3Hku4TjH`)의 해당 화면
  - 타입: `src/types/api`에 정의된 요청 · 응답 타입. API 데이터의 타입을 새로 만들지 않고 여기서 가져온다
- 단일 모듈(컴포넌트 · 서버 액션 · 조회 함수 · 스키마 등) 하나를 구현할 때마다, 그 모듈이 따르는 설계(Figma 화면 · mock Swagger의 해당 API · 타입)를 먼저 확인한다.
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
- 예외: Presigned URL로 S3에 올리고 받는 파일, STT 회사로 보내는 실시간 음성은 브라우저가 직접 보낸다(API 명세 1장). 그 주소·토큰을 받는 API 호출 자체는 서버에서 한다.
