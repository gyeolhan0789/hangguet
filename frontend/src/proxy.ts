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

// 액세스 토큰 쿠키가 만료돼 없고 리프레시 토큰만 남아 있으면, 페이지·서버 액션이 실행되기 전에 재발급한다.
export async function proxy(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (request.cookies.has(ACCESS_TOKEN_COOKIE) || !refreshToken) {
    return NextResponse.next();
  }

  const tokens = await refreshTokens(refreshToken);
  if (!tokens) {
    // REFRESH_TOKEN_INVALID: 로그아웃 상태로 이어서 처리한다.
    request.cookies.delete(REFRESH_TOKEN_COOKIE);
    const response = NextResponse.next({ request: { headers: request.headers } });
    clearAuthCookies(response.cookies);
    return response;
  }

  // 이번 요청의 서버 컴포넌트가 새 토큰을 읽도록 요청 쿠키도 바꾼다.
  request.cookies.set(ACCESS_TOKEN_COOKIE, tokens.accessToken);
  request.cookies.set(REFRESH_TOKEN_COOKIE, tokens.refreshToken);
  const response = NextResponse.next({ request: { headers: request.headers } });
  setAuthCookies(response.cookies, tokens);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
