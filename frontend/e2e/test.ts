import type { BrowserContext, Locator, Page } from "@playwright/test";
import { expect, test as base } from "next/experimental/testmode/playwright/msw";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";
import { E2E_TODAY_HEADER } from "../src/lib/today";
import type { LocalDate } from "../src/types/api";

import { AUTH_TOKENS } from "./mocks/data";
import { defaultHandlers } from "./mocks/handlers";

export { expect, http, HttpResponse } from "next/experimental/testmode/playwright/msw";
export { api, homeDoneToday, problemResponse, roomStaysConnecting } from "./mocks/handlers";

interface SignInOptions {
  /** 액세스 토큰 쿠키를 넣을지. false면 만료돼 지워진 상태 */
  access?: boolean;
  /** 리프레시 토큰 쿠키를 넣을지 */
  refresh?: boolean;
}

interface Fixtures {
  /**
   * 로그인 상태로 시작한다: 로그인(1.3) 성공 때와 같은 httpOnly 토큰 쿠키를 넣는다. page.goto 전에 부른다.
   * 리프레시 토큰은 test마다 다른 값이다. proxy는 같은 리프레시 토큰의 재발급 결과(실패 포함)를 잠깐 함께 쓰므로,
   * 같은 E2E 서버를 병렬로 쓰는 test끼리 재발급 결과가 섞이지 않게 한다. spec에서 토큰 문자열을 넣지 않는다.
   */
  signIn: (options?: SignInOptions) => Promise<void>;
  /** 앱 밖 주소의 이미지(예: 프로필 사진 profileImageUrl)는 실제로 받지 않고 1px 그림으로 답한다. 모든 test에 자동으로 걸린다 */
  externalImages: void;
}

/** 투명한 1×1 PNG */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

/** E2E의 test: 기본 MSW 핸들러(응답만 주는 웹 Swagger 예시) · signIn · externalImages를 붙인 Playwright test */
export const test = base.extend<Fixtures>({
  mswHandlers: [defaultHandlers, { scope: "test" }],
  // Next test mode가 먼저 걸어 둔 page.route보다 나중에 걸어 먼저 받고, 이미지가 아니면 그쪽으로 넘긴다.
  externalImages: [
    async ({ page, baseURL }, use) => {
      const appOrigin = new URL(baseURL!).origin;
      await page.route(
        (url) => url.origin !== appOrigin,
        (route) =>
          route.request().resourceType() === "image"
            ? route.fulfill({ contentType: "image/png", body: PIXEL_PNG })
            : route.fallback(),
      );
      await use();
    },
    { auto: true },
  ],
  signIn: async ({ context, baseURL }, use, testInfo) => {
    // 같은 test를 반복 · 재시도해도 겹치지 않게 반복 · 재시도 번호까지 붙인다.
    const refreshToken = `${AUTH_TOKENS.refreshToken}-${testInfo.testId}-${testInfo.repeatEachIndex}-${testInfo.retry}`;
    await use(async ({ access = true, refresh = true } = {}) => {
      const tokenCookie = (name: string, value: string) => ({
        name,
        value,
        url: baseURL!,
        httpOnly: true,
        sameSite: "Lax" as const,
      });
      await context.addCookies([
        ...(access ? [tokenCookie(ACCESS_TOKEN_COOKIE, AUTH_TOKENS.accessToken)] : []),
        ...(refresh ? [tokenCookie(REFRESH_TOKEN_COOKIE, refreshToken)] : []),
      ]);
    });
  },
});

/**
 * 브라우저의 쿠키 하나(없으면 undefined). httpOnly 토큰 쿠키 · 카카오 쿠키처럼 화면 밖 값을 판정하거나,
 * 새로 고치기 전에 쿠키가 바뀌길 expect.poll로 기다릴 때 쓴다.
 */
export async function cookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((item) => item.name === name);
}

/**
 * 서버 컴포넌트 · 서버 액션이 쓰는 '오늘'(YYYY-MM-DD, src/lib/today.ts의 serverToday)을 정한다.
 * 날짜에 따라 화면이 바뀌는 test에서 page.goto 전에 부른다. spec에서 E2E 오늘 헤더를 직접 쓰지 않는다.
 */
export async function fixServerToday(page: Page, date: LocalDate) {
  await page.setExtraHTTPHeaders({ [E2E_TODAY_HEADER]: date });
}

/**
 * 요소에 React가 붙을 때(하이드레이션)까지 기다린다. SSR 마크업만으로도 보이고 켜져 있는 onClick 버튼은
 * 하이드레이션 전에 누르면 클릭이 사라지고 다시 시도되지 않으므로, 누르기 전 · 효과(문구 · 토스트)가 없음을 보기 전에 쓴다.
 */
export async function hydrated(locator: Locator) {
  await expect
    .poll(
      () =>
        locator.evaluate((element) =>
          Object.keys(element).some((key) => key.startsWith("__reactProps$")),
        ),
      // 기본 간격(100 · 250 · 500 · 1000ms)이면 하이드레이션 뒤 최대 1초를 늦게 알아채 그동안 앱 타이머가 실제 시간으로 흐른다
      { intervals: [20] },
    )
    .toBe(true);
}
