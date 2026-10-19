import type { RefreshResponse } from "@/types/api";

export const ACCESS_TOKEN_COOKIE = "hk_access";
export const REFRESH_TOKEN_COOKIE = "hk_refresh";

// 액세스 토큰 쿠키는 토큰보다 조금 먼저 지워지게 해서, 만료 직전에 proxy가 미리 재발급하게 한다.
const ACCESS_TOKEN_MARGIN_SECONDS = 30;
// 리프레시 토큰의 실제 유효 기간은 BE가 정한다(API 명세 1.3). 쿠키는 그보다 길게만 두면 된다.
const REFRESH_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const baseOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

/** `cookies()`(서버 액션·Route Handler)와 `NextResponse.cookies`(proxy)가 같이 쓰는 모양 */
interface CookieWriter {
  set(name: string, value: string, options?: Record<string, unknown>): unknown;
  delete(name: string): unknown;
}

/** 로그인(1.3)·토큰 재발급(1.4) 응답을 쿠키에 저장한다. */
export function setAuthCookies(cookies: CookieWriter, tokens: RefreshResponse) {
  cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...baseOptions,
    maxAge: Math.max(tokens.expiresIn - ACCESS_TOKEN_MARGIN_SECONDS, 0),
  });
  cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseOptions,
    maxAge: REFRESH_TOKEN_MAX_AGE_SECONDS,
  });
}

/** 로그아웃(1.5)·회원 탈퇴(2.7)·재발급 실패 시 쿠키를 지운다. */
export function clearAuthCookies(cookies: CookieWriter) {
  cookies.delete(ACCESS_TOKEN_COOKIE);
  cookies.delete(REFRESH_TOKEN_COOKIE);
}
