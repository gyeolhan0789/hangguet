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
  const session = await refreshSession(request);
  const response = routeResponse(request, session);
  if (session.refreshed) setAuthCookies(response.cookies, session.refreshed);
  else if (session.refreshed === null) clearAuthCookies(response.cookies);
  return response;
}

interface Session {
  loggedIn: boolean;
  /** undefined: 재발급 안 함(또는 무효가 아닌 실패), null: 다시 로그인해야 함(웹 Swagger 1.4 REFRESH_TOKEN_INVALID) */
  refreshed: RefreshResponse | null | undefined;
  /** 재발급이 무효 판정이 아닌 이유(500 · 연결 오류)로 실패했다. 쿠키를 지우지 않고 화면에 맡긴다 */
  refreshFailed: boolean;
}

/** ① 액세스 토큰이 없거나 곧 끝나고 리프레시 토큰이 있으면 재발급한다 */
async function refreshSession(request: NextRequest): Promise<Session> {
  const accessToken = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessToken && !isAccessTokenExpired(accessToken)) {
    return { loggedIn: true, refreshed: undefined, refreshFailed: false };
  }
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) return { loggedIn: false, refreshed: undefined, refreshFailed: false };

  let refreshed: RefreshResponse | null;
  try {
    refreshed = await refreshTokens(refreshToken);
  } catch {
    return { loggedIn: false, refreshed: undefined, refreshFailed: true };
  }
  if (refreshed) {
    // 이번 요청의 서버 컴포넌트가 새 토큰을 읽도록 요청 쿠키도 바꾼다.
    request.cookies.set(ACCESS_TOKEN_COOKIE, refreshed.accessToken);
    request.cookies.set(REFRESH_TOKEN_COOKIE, refreshed.refreshToken);
  } else if (refreshed === null) {
    request.cookies.delete(ACCESS_TOKEN_COOKIE);
    request.cookies.delete(REFRESH_TOKEN_COOKIE);
  }
  return { loggedIn: refreshed != null, refreshed, refreshFailed: false };
}

/** ② 로그인 여부에 맞지 않는 화면이면 보내고, 맞으면 그대로 그린다 */
function routeResponse(request: NextRequest, session: Session): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (session.loggedIn && GUEST_ONLY_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL(ROUTES.home, request.url));
  }
  if (!session.loggedIn && !session.refreshFailed && !PUBLIC_PATHS.includes(pathname)) {
    return NextResponse.redirect(new URL(ROUTES.login, request.url));
  }
  // 화면을 그리다 TOKEN_EXPIRED를 받으면 재발급 뒤 이 주소로 돌아온다.
  request.headers.set(PATHNAME_HEADER, `${pathname}${search}`);
  // 화면 주소에 오는 POST는 서버 액션뿐이다(Next 문서 mutating-data). 밖에서 보낸 값은 덮어쓴다.
  request.headers.set(SERVER_ACTION_HEADER, request.method === "POST" ? "1" : "0");
  return NextResponse.next({ request: { headers: request.headers } });
}

export const config = {
  // API·Next 내부 파일·public 정적 파일(확장자가 있는 주소)은 거치지 않는다.
  // Next가 빌드 때 그대로 읽는 문자열 상수여야 해서 String.raw를 쓰지 않는다(Next 문서 proxy matcher).
  // 점은 역슬래시 대신 문자 집합 [.]으로 적는다(뜻은 같다).
  matcher: ["/((?!api|_next/static|_next/image|.*[.].*).*)"],
};
