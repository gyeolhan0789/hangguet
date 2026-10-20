import type { NextConfig } from "next";

// `npm run e2e`(Playwright)가 NEXT_TEST_PROXY=1로 빌드·실행하는 E2E 전용 빌드인지.
// 일반 빌드와 섞이지 않도록 결과물도 .next-e2e에 따로 둔다.
const e2eBuild = process.env.NEXT_TEST_PROXY === "1";

const nextConfig: NextConfig = {
  /* config options here */
  // 배포 이미지용. 빌드할 때 실행에 필요한 파일만 .next/standalone에 모으고, node server.js로 띄운다.
  // public과 .next/static은 들어가지 않아 Dockerfile에서 따로 복사한다. next dev와 next start에는 영향이 없다.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  distDir: e2eBuild ? ".next-e2e" : ".next",
  env: {
    // 빌드할 때 코드의 process.env.E2E_BUILD를 이 값으로 바꿔 넣는다.
    // 일반 빌드에서는 "0"이 되어 E2E 전용 분기(src/lib/today.ts)가 결과물에서 빠진다.
    E2E_BUILD: e2eBuild ? "1" : "0",
  },
  experimental: {
    // E2E(Playwright)에서 서버가 보내는 API 요청을 테스트가 가로채 mock 응답을 주게 한다.
    // E2E 전용 빌드에서만 켜지고, 일반 실행·배포에서는 꺼져 있다.
    testProxy: e2eBuild,
  },
};

export default nextConfig;
