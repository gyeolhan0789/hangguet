import type { Locator, Page } from "@playwright/test";
import { expect, test as base } from "next/experimental/testmode/playwright/msw";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "../src/lib/api/auth-cookies";

import { AUTH_TOKENS } from "./mocks/data";
import { defaultHandlers } from "./mocks/handlers";

export { expect, http, HttpResponse } from "next/experimental/testmode/playwright/msw";
export { api, problemResponse, recordSessions } from "./mocks/handlers";

interface SignInOptions {
  /** 액세스 토큰 쿠키를 넣을지. false면 만료돼 지워진 상태 */
  access?: boolean;
  /** 액세스 토큰 값. 기본은 로그인(1.3) 응답의 토큰 */
  accessToken?: string;
  /** 리프레시 토큰 쿠키를 넣을지 */
  refresh?: boolean;
  /**
   * 리프레시 토큰 값. proxy는 같은 토큰의 재발급 결과를 잠깐 공유하므로,
   * 재발급을 거치는 테스트는 서로 다른 값을 줘서 다른 테스트의 결과를 받지 않게 한다.
   */
  refreshToken?: string;
}

interface Fixtures {
  /** 로그인 상태로 시작한다: 로그인(1.3) 성공 때와 같은 httpOnly 토큰 쿠키를 넣는다. */
  signIn: (options?: SignInOptions) => Promise<void>;
  /** 앱 밖 주소의 이미지(예: 프로필 사진 profileImageUrl)는 실제로 받지 않고 1px 그림으로 답한다. */
  externalImages: void;
}

/** 투명한 1×1 PNG */
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

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
  signIn: async ({ context, baseURL }, use) => {
    await use(
      async ({
        access = true,
        accessToken = AUTH_TOKENS.accessToken,
        refresh = true,
        refreshToken = AUTH_TOKENS.refreshToken,
      } = {}) => {
        const cookie = (name: string, value: string) => ({
          name,
          value,
          url: baseURL!,
          httpOnly: true,
          sameSite: "Lax" as const,
        });
        await context.addCookies([
          ...(access ? [cookie(ACCESS_TOKEN_COOKIE, accessToken)] : []),
          ...(refresh ? [cookie(REFRESH_TOKEN_COOKIE, refreshToken)] : []),
        ]);
      },
    );
  },
});

/**
 * 요소에 React가 붙을 때(하이드레이션)까지 기다린다. SSR 마크업만으로도 보이고 켜져 있는 onClick 버튼은
 * 하이드레이션 전에 누르면 클릭이 사라지고 다시 시도되지 않으므로, 누르기 전 · 효과(문구 · 토스트)가 없음을 보기 전에 쓴다.
 */
export async function hydrated(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
}

/**
 * clock.install() 뒤 페이지가 실제 시간으로 다 뜬 다음에 시계를 멈춘다. 이후 타이머(토스트 2초 등)는 runFor로만 흐른다.
 * 뜨기 전에 멈추면 React 스트리밍 공개 스크립트(requestAnimationFrame · setTimeout)도 멈춰 화면이 나오지 않는다.
 * 지난 시각으로는 멈출 수 없어(Playwright) 페이지 시각보다 조금 뒤로 멈춘다.
 */
export async function pauseClock(page: Page) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 500);
}
