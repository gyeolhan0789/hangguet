import { defineConfig, devices } from "@playwright/test";

// 개발 서버(3000)와 겹치지 않는 포트에 E2E 전용 서버를 띄운다.
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * E2E 테스트 (Playwright + Next test mode + MSW).
 * 이 앱은 API를 서버(서버 컴포넌트 · 서버 액션 · proxy)에서 부르므로 page.route()로는 가로챌 수 없다.
 * Next test mode가 서버의 API 요청을 테스트로 넘기고, 각 테스트가 MSW 핸들러로 mock 응답을 준다.
 * 핸들러가 없는 요청은 실제 서버로 나가지 않고 실패한다.
 */
export default defineConfig({
  testDir: "./e2e",
  // Next 기본 설정은 app·pages 폴더 안의 spec만 찾으므로 e2e 폴더 기준으로 덮어쓴다.
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // NEXT_TEST_PROXY=1이면 E2E 전용 빌드(.next-e2e)를 만들고 띄운다(next.config.ts). 일반 빌드(.next)와 섞이지 않는다.
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE_URL,
    env: { NEXT_TEST_PROXY: "1" },
    // Playwright 공식 권장값: 로컬에서는 이미 떠 있는 E2E 서버를 다시 쓰고, CI에서는 항상 새로 띄운다.
    // 코드를 고친 뒤 로컬에서 돌릴 때는 떠 있던 서버(예: UI 모드)를 끄고 다시 빌드해야 고친 내용이 반영된다.
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
