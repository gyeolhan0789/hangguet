// 화면 주소 모음. 화면 번호는 Figma·API 명세 기준이다.
export const ROUTES = {
  /** S00 랜딩 */
  landing: "/",
  /** S01 로그인 */
  login: "/login",
  /** S01-1 회원가입 */
  signup: "/signup",
  /** S02 홈. 오늘 완료(S02-B) · 끊김(S02-C) · 첫 방문(S02-D)도 같은 주소에서 상태로 나눈다. */
  home: "/home",
  /** S03 지원서 입력 — 연습 시작 (아직 화면 없음) */
  practice: "/practice",
  /** 헤더 [연습 기록] (화면 미정) */
  records: "/records",
  /** S09 마이페이지 */
  mypage: "/mypage",
  /** 화면을 그리는 도중 액세스 토큰이 만료됐을 때(TOKEN_EXPIRED) 재발급하고 돌아오는 Route Handler */
  tokenRefresh: "/api/auth/refresh",
  /** 화면을 그리는 도중 API가 UNAUTHORIZED를 줬을 때 쿠키를 지우고 로그인 전 상태로 보내는 Route Handler */
  signedOut: "/api/auth/signed-out",
} as const;

/** S08 날짜별 성장 리뷰 (아직 화면 없음). practiceDate는 YYYY-MM-DD */
export const growthReviewPath = (practiceDate: string) => `/reviews/${practiceDate}`;

/** 로그인하지 않아도 볼 수 있는 화면 */
export const PUBLIC_PATHS: readonly string[] = [ROUTES.landing, ROUTES.login, ROUTES.signup];

/** 로그인한 사람은 들어오지 않는 화면(로그인하면 홈으로 보낸다) */
export const GUEST_ONLY_PATHS: readonly string[] = [ROUTES.login, ROUTES.signup];
