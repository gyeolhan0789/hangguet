// 화면 주소 모음. 화면 번호는 Figma·API 명세 기준이다.
export const ROUTES = {
  /** S00 랜딩 */
  landing: "/",
  /** S01 로그인 */
  login: "/login",
  /** S01-1 회원가입 */
  signup: "/signup",
  /** S02 홈 (아직 화면 없음). 가입 직후 S02-D 첫 방문 홈도 같은 주소에서 상태로 나눈다. */
  home: "/home",
  /** 헤더 [연습 기록] (화면 미정) */
  records: "/records",
  /** S09 마이페이지 */
  mypage: "/mypage",
} as const;

/** 로그인하지 않아도 볼 수 있는 화면 */
export const PUBLIC_PATHS: readonly string[] = [ROUTES.landing, ROUTES.login, ROUTES.signup];

/** 로그인한 사람은 들어오지 않는 화면(로그인하면 홈으로 보낸다) */
export const GUEST_ONLY_PATHS: readonly string[] = [ROUTES.login, ROUTES.signup];
