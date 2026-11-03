// 실행 환경 값(loadtest/README.md). 비밀값은 환경 변수로만 받는다.

/** 부하를 보낼 주소. 실제 사용자와 같은 길(Cloudflare → Tunnel → Nginx)로 보낸다(load_test_plan 3.2) */
export const BASE_URL = (__ENV.BASE_URL || "https://lt.hangguet.co.kr").replace(/\/$/, "");

/** BE API. Nginx가 /be/를 BE로 넘긴다 */
export const API = `${BASE_URL}/be/api/v1`;

/** 테스트 계정 공통 비밀번호(seed가 가입할 때 쓴 값) */
export const PASSWORD = __ENV.LOADTEST_PASSWORD;

/** 테스트 계정 이메일. 테스트 서버 DB에만 있다(load_test_plan 3.6) */
export function accountEmail(index) {
  return `loadtest+${String(index).padStart(4, "0")}@loadtest.hangguet.co.kr`;
}

export function requirePassword() {
  if (!PASSWORD) {
    throw new Error("LOADTEST_PASSWORD가 필요하다(loadtest/.env.k6)");
  }
}
