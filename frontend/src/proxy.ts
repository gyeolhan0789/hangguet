import axios from "axios";
import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  clearAuthCookies,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from "@/lib/api/auth-cookies";
import { defaultConfig } from "@/lib/api/config";
import { authEndpoints } from "@/lib/api/endpoints";
import type { TokenResponse } from "@/lib/api/types";
import { GUEST_ONLY_PATHS, PUBLIC_PATHS, ROUTES } from "@/lib/routes";

const refreshClient = axios.create(defaultConfig);

// 한 번 쓴 리프레시 토큰은 폐기되므로(API 명세 1.4), 동시에 들어온 요청이 같은 토큰으로
// 재발급을 두 번 부르지 않도록 진행 중인 재발급을 잠시 공유한다.
const pendingRefreshes = new Map<string, Promise<TokenResponse | null>>();
const SHARE_REFRESH_MS = 10_000;

function refreshTokens(refreshToken: string): Promise<TokenResponse | null> {
  let pending = pendingRefreshes.get(refreshToken);
  if (!pending) {
    pending = refreshClient
      .post<TokenResponse>(authEndpoints.tokenRefresh, { refreshToken })
      .then(({ data }) => data)
      .catch(() => null);
    pendingRefreshes.set(refreshToken, pending);
    setTimeout(() => pendingRefreshes.delete(refreshToken), SHARE_REFRESH_MS);
  }
  return pending;
}

// 페이지·서버 액션이 실행되기 전에
// ① 액세스 토큰 쿠키가 만료돼 없고 리프레시 토큰만 남았으면 재발급하고
// ② 로그인 여부에 맞지 않는 화면이면 보낸다(로그인 전 → 로그인, 로그인 후 로그인·가입 화면 → 홈).
export async function proxy(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  let loggedIn = request.cookies.has(ACCESS_TOKEN_COOKIE);
  /** undefined: 재발급 안 함, null: 재발급 실패(REFRESH_TOKEN_INVALID) */
  let refreshed: TokenResponse | null | undefined;

  if (!loggedIn && refreshToken) {
    refreshed = await refreshTokens(refreshToken);
    loggedIn = refreshed !== null;
    if (refreshed) {
      // 이번 요청의 서버 컴포넌트가 새 토큰을 읽도록 요청 쿠키도 바꾼다.
      request.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken);
      request.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refreshToken);
    } else {
      request.cookies.delete(REFRESH_TOKEN_COOKIE);
    }
  }

  const { pathname } = request.nextUrl;
  let response: NextResponse;
  if (loggedIn && GUEST_ONLY_PATHS.includes(pathname)) {
    response = NextResponse.redirect(new URL(ROUTES.home, request.url));
  } else if (!loggedIn && !PUBLIC_PATHS.includes(pathname)) {
    response = NextResponse.redirect(new URL(ROUTES.login, request.url));
  } else {
    response = NextResponse.next({ request: { headers: request.headers } });
  }

  if (refreshed) setAuthCookies(response.cookies, refreshed);
  else if (refreshed === null) clearAuthCookies(response.cookies);
  return response;
}

export const config = {
  // API·Next 내부 파일·public 정적 파일(확장자가 있는 주소)은 거치지 않는다.
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
