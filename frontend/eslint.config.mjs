import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Playwright fixture의 use()는 React Hook이 아니다. fixture를 정의하는 파일에서만 끈다.
  {
    files: ["e2e/test.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  // 서식 규칙은 Prettier가 맡는다. 겹치는 ESLint 규칙을 끄기 위해 마지막에 둔다.
  prettier,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-e2e/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    // three.js 예제에서 가져온 코드(MIT). 원본 그대로 둔다.
    "src/lib/interviewer/vendor/**",
    // MediaPipe WASM 로더(node_modules에서 복사한 원본, scripts/copy-mediapipe-wasm.mjs)
    "public/mediapipe/wasm/**",
  ]),
]);

export default eslintConfig;
