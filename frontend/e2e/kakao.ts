import type { BrowserContext, Page } from "@playwright/test";

// 카카오 인가 화면(kauth.kakao.com) 대신 쓰는 E2E 도우미.
// 인가 화면은 빈 페이지로 가로채고, 카카오가 하듯 콜백 주소로 돌아가는 이동은 테스트가 page.goto로 새로 한다. 302로 되돌리면
// Next test mode가 붙이는 테스트 헤더가 이어지는 요청(콜백 · 그 뒤 이동)에 실리지 않아, 콜백이 부르는 1.6 · 2.9가 MSW 대신 실제
// 서버로 나간다(Playwright는 리다이렉트로 이어지는 요청에 route를 다시 부르지 않는다). 새 이동은 context route를 거쳐 헤더가 붙는다.
// E2E 서버는 운영 빌드라 카카오 쿠키 이름에 __Host-가 붙는다(lib/auth/kakao.ts). __Host- 쿠키는 http에서 addCookies로 넣을 수 없어
// 서버가 심게 한다(버튼을 눌러 진짜 state를 받는다).

/** playwright.config.ts webServer.env의 KAKAO_CLIENT_ID와 같다 */
export const KAKAO_CLIENT_ID = "e2e-kakao-client-id";
/** playwright.config.ts webServer.env의 KAKAO_REDIRECT_URI와 같다 */
export const KAKAO_CALLBACK = "http://localhost:3100/oauth/kakao/callback";
export const KAKAO_STATE_COOKIE = "__Host-hk_oauth_state";
export const KAKAO_SIGNUP_COOKIE = "__Host-hk_social_signup";
export const KAKAO_NOTICE_COOKIE = "__Host-hk_notice";

export interface KakaoAuthorize {
  /** 가장 최근에 가로챈 인가 요청 주소 */
  last(): URL;
  /** 카카오에서 동의(code) · 취소(error)하고 콜백으로 돌아간다. 콜백과 그 뒤 이동까지 끝날 때까지 기다린다 */
  returns(result: { code: string } | { error: string }, state?: string): Promise<void>;
}

/** 카카오 인가 화면을 빈 페이지('카카오')로 가로챈다 */
export async function interceptKakao(page: Page): Promise<KakaoAuthorize> {
  const requested: URL[] = [];
  await page.route("https://kauth.kakao.com/**", (route) => {
    const url = new URL(route.request().url());
    // 인가 화면이 아닌 부수 요청(favicon 등)은 기록하지 않는다
    if (url.pathname !== "/oauth/authorize") return route.fulfill({ status: 404 });
    requested.push(url);
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<meta charset="utf-8"><title>카카오</title>',
    });
  });
  const last = () => {
    const url = requested.at(-1);
    if (!url) throw new Error("카카오 인가 화면으로 가지 않았습니다");
    return url;
  };
  return {
    last,
    async returns(result, state) {
      const authorize = last();
      const back = new URL(authorize.searchParams.get("redirect_uri")!);
      if ("code" in result) back.searchParams.set("code", result.code);
      else back.searchParams.set("error", result.error);
      back.searchParams.set("state", state ?? authorize.searchParams.get("state")!);
      await page.goto(back.toString());
    },
  };
}

/** 쿠키 하나(없으면 undefined) */
export async function cookie(context: BrowserContext, name: string) {
  return (await context.cookies()).find((item) => item.name === name);
}
