import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { clearAuthCookies, REFRESH_TOKEN_COOKIE, setAuthCookies } from "@/lib/api/auth-cookies";
import { refreshTokens } from "@/lib/api/token-refresh";
import { PUBLIC_PATHS, ROUTES } from "@/lib/routes";

// API 명세 1장 공통 오류(401) 처리.
// - TOKEN_EXPIRED(만료): 재발급한 뒤 다시 요청한다
// - UNAUTHORIZED(토큰 없음 · 위조 · 탈퇴): 쿠키를 지운다
// 화면(서버 컴포넌트)을 그리는 중에는 쿠키를 쓸 수 없으므로(Next 문서 cookies) Route Handler로 보내 처리하고 돌아온다.
// 서버 액션 안에서는 쿠키를 직접 바꾼다: 서버 액션의 redirect는 화면 안 이동(Next 문서 redirect)이라 Route Handler에 닿지 않는다.

/** proxy가 지금 화면 주소(경로 + 쿼리)를 서버 컴포넌트에 넘겨주는 요청 헤더 */
export const PATHNAME_HEADER = "x-hk-pathname";

/** proxy가 서버 액션 요청인지 넘겨주는 요청 헤더. 서버 액션은 POST로만 불린다(Next 문서 mutating-data). */
export const SERVER_ACTION_HEADER = "x-hk-server-action";

/** 재발급 Route Handler가 방금 재발급했다고 남기는 쿠키. 그래도 만료라고 하면 재발급을 반복하지 않는다. */
export const JUST_REFRESHED_COOKIE = "hk_refreshed";
export const JUST_REFRESHED_MAX_AGE_SECONDS = 10;

interface CookieWriter {
  set(name: string, value: string, options?: Record<string, unknown>): unknown;
}

/** 방금 재발급했다는 표시를 잠깐 남긴다(Route Handler · 서버 액션 공통). */
export function markJustRefreshed(cookies: CookieWriter) {
  cookies.set(JUST_REFRESHED_COOKIE, "1", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: JUST_REFRESHED_MAX_AGE_SECONDS,
  });
}

/** 돌아갈 주소. 이 사이트 안의 경로만 허용해 다른 사이트로 보내지 않는다. */
export function safeNextPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return ROUTES.home;
  }
  return next;
}

/**
 * 로그인이 풀린 뒤 갈 곳: 로그인 없이 보는 화면(랜딩 등)이면 그 화면에 머물고, 아니면 S01 로그인.
 * (명세 1.4 REFRESH_TOKEN_INVALID "화면은 S01로"와 같은 기준)
 */
export function pathAfterSignedOut(next: string | null): string {
  const path = safeNextPath(next);
  return PUBLIC_PATHS.includes(new URL(path, "http://localhost").pathname) ? path : ROUTES.login;
}

async function currentPath(): Promise<string> {
  return (await headers()).get(PATHNAME_HEADER) ?? ROUTES.home;
}

async function inServerAction(): Promise<boolean> {
  return (await headers()).get(SERVER_ACTION_HEADER) === "1";
}

/** API가 401 TOKEN_EXPIRED를 줬을 때. 방금 재발급했다면 아무것도 하지 않고 원래 오류를 그대로 둔다. */
export async function redirectToTokenRefresh(): Promise<void> {
  const store = await cookies();
  if (store.has(JUST_REFRESHED_COOKIE)) return;
  const path = await currentPath();

  if (await inServerAction()) {
    // 재발급해 쿠키에 저장하고 지금 화면을 새 토큰으로 다시 그린다. 하던 일(제출)은 다시 누르면 된다.
    const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
    const tokens = refreshToken ? await refreshTokens(refreshToken) : null;
    if (!tokens) {
      clearAuthCookies(store);
      redirect(ROUTES.login);
    }
    setAuthCookies(store, tokens);
    markJustRefreshed(store);
    redirect(safeNextPath(path));
  }
  redirect(`${ROUTES.tokenRefresh}?next=${encodeURIComponent(path)}`);
}

/** API가 401 UNAUTHORIZED를 줬을 때: 쿠키를 지우고 로그인 전 상태로 돌아간다. */
export async function redirectToSignedOut(): Promise<void> {
  const path = await currentPath();

  if (await inServerAction()) {
    clearAuthCookies(await cookies());
    redirect(pathAfterSignedOut(path));
  }
  redirect(`${ROUTES.signedOut}?next=${encodeURIComponent(path)}`);
}
