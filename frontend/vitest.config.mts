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
