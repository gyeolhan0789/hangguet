import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Pact 계약 테스트(npm run test:pact). FE의 실제 조회 · 서버 액션 함수를 Pact 가짜 서버에 보내 계약 파일(pacts/)을 만든다.
// Pact 가짜 서버와 계약 파일은 상태가 있어 파일을 차례로 돌린다(pact-js troubleshooting: 병렬 실행 비권장).
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.pact.test.ts"],
    globalSetup: ["src/test/pact-global-setup.ts"],
    setupFiles: ["src/test/pact-setup.ts"],
    fileParallelism: false,
  },
});
