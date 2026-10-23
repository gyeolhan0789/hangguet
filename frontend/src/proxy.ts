import { NextResponse, type NextRequest } from "next/server";

import {
  ACCESS_TOKEN_COOKIE,
  clearAuthCookies,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from "@/lib/api/auth-cookies";
import { isAccessTokenExpired, refreshTokens } from "@/lib/api/token-refresh";
import { PATHNAME_HEADER, SERVER_ACTION_HEADER } from "@/lib/auth/auth-errors";
import { GUEST_ONLY_PATHS, PUBLIC_PATHS, ROUTES } from "@/lib/routes";
import type { RefreshResponse } from "@/types/api";

// 페이지·서버 액션이 실행되기 전에
// ① 액세스 토큰이 없거나(쿠키 만료) 곧 끝나고 리프레시 토큰이 있으면 재발급하고
// ② 로그인 여부에 맞지 않는 화면이면 보낸다(로그인 전 → 로그인, 로그인 후 로그인·가입 화면 → 홈).
// 그래도 화면을 그리는 도중 API가 TOKEN_EXPIRED를 주면 재발급 Route Handler가 맡는다(src/lib/auth/auth-errors.ts).
export async function proxy(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  let loggedIn = !!accessToken && !isAccessTokenExpired(accessToken);
  /** undefined: 재발급 안 함(또는 무효가 아닌 실패), null: 다시 로그인해야 함(웹 Swagger 1.4 REFRESH_TOKEN_INVALID) */
  let refreshed: RefreshResponse | null | undefined;
  /** 재발급이 무효 판정이 아닌 이유(500 · 연결 오류)로 실패했다. 쿠키를 지우지 않고 화면에 맡긴다 */
  let refreshFailed = false;

  if (!loggedIn && refreshToken) {
    try {
      refreshed = await refreshTokens(refreshToken);
    } catch {
      refreshFailed = true;
    }
    loggedIn = refreshed != null;
    if (refreshed) {
      // 이번 요청의 서버 컴포넌트가 새 토큰을 읽도록 요청 쿠키도 바꾼다.
      request.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken);
      request.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refreshToken);
    } else if (refreshed === null) {
      request.cookies.delete(ACCESS_TOKEN_COOKIE);
      request.cookies.delete(REFRESH_TOKEN_COOKIE);
    }
  }

  const { pathname, search } = request.nextUrl;
  let response: NextResponse;
  if (loggedIn && GUEST_ONLY_PATHS.includes(pathname)) {
    response = NextResponse.redirect(new URL(ROUTES.home, request.url));
  } else if (!loggedIn && !refreshFailed && !PUBLIC_PATHS.includes(pathname)) {
    response = NextResponse.redirect(new URL(ROUTES.login, request.url));
  } else {
    // 화면을 그리다 TOKEN_EXPIRED를 받으면 재발급 뒤 이 주소로 돌아온다.
    request.headers.set(PATHNAME_HEADER, `${pathname}${search}`);
    // 화면 주소에 오는 POST는 서버 액션뿐이다(Next 문서 mutating-data). 밖에서 보낸 값은 덮어쓴다.
    request.headers.set(SERVER_ACTION_HEADER, request.method === "POST" ? "1" : "0");
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
