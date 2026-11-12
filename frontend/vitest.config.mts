import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    // 테스트 독립 · 결정성(테스트 규칙): 시간대 고정, 테스트마다 mock 기록 · 구현 · spy · 전역 · 환경 변수를 되돌린다.
    // 남은 정리(화면 · 가짜 타이머 · 가짜 쿠키)는 setup.ts가 한다. 단언이 하나도 없는 테스트는 실패로 본다.
    env: { TZ: "Asia/Seoul" },
    setupFiles: ["src/test/setup.ts"],
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    expect: { requireAssertions: true },
    // Pact 계약 테스트는 따로 돈다(npm run test:pact, vitest.pact.config.mts)
    exclude: [...configDefaults.exclude, "src/**/*.pact.test.ts"],
    coverage: {
      provider: "v8",
      // SonarQube가 읽을 커버리지 리포트 (coverage/lcov.info)
      reporter: ["text", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.d.ts", "src/test/**"],
    },
  },
});
