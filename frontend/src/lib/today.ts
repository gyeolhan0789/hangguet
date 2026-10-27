import { headers } from "next/headers";

import { todayKst } from "./date";

/**
 * E2E(Playwright)가 서버의 '오늘'을 정할 때 보내는 요청 헤더(YYYY-MM-DD).
 * 서버 컴포넌트는 Node에서 돌아 브라우저 시계(page.clock)로는 바꿀 수 없어서, 요청마다 시계를 넘겨받는다.
 */
export const E2E_TODAY_HEADER = "x-e2e-today";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** E2E 빌드에서 요청 헤더로 받은 '오늘'. 없거나 형식이 틀리면 null */
async function e2eToday(): Promise<string | null> {
  const fixed = (await headers()).get(E2E_TODAY_HEADER);
  return fixed && DATE.test(fixed) ? fixed : null;
}

/**
 * 서버에서 쓰는 한국 시간 기준 오늘(YYYY-MM-DD).
 * process.env.E2E_BUILD는 빌드할 때 값이 박히므로(next.config.ts env), 일반 빌드에서는 이 분기가 통째로 빠지고
 * 헤더를 읽는 코드가 결과물에 남지 않는다.
 */
export async function serverToday(): Promise<string> {
  if (process.env.E2E_BUILD === "1") {
    const fixed = await e2eToday();
    if (fixed) return fixed;
  }
  return todayKst();
}
