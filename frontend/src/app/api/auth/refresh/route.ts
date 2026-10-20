import { NextResponse, type NextRequest } from "next/server";

import { clearAuthCookies, REFRESH_TOKEN_COOKIE, setAuthCookies } from "@/lib/api/auth-cookies";
import { refreshTokens } from "@/lib/api/token-refresh";
import { markJustRefreshed, safeNextPath } from "@/lib/auth/auth-errors";
import { ROUTES } from "@/lib/routes";

// 화면을 그리는 도중 API가 401 TOKEN_EXPIRED를 주면 여기로 온다(src/lib/auth/auth-errors.ts).
// 1.4로 재발급해 쿠키에 저장하고 원래 화면(next)으로 돌려보낸다. 재발급이 안 되면 로그인 화면으로 보낸다.
export async function GET(request: NextRequest) {
  const refreshToken = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  const tokens = refreshToken ? await refreshTokens(refreshToken) : null;

  if (!tokens) {
    const response = NextResponse.redirect(new URL(ROUTES.login, request.url));
    clearAuthCookies(response.cookies);
    return response;
  }

  const next = safeNextPath(request.nextUrl.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(next, request.url));
  setAuthCookies(response.cookies, tokens);
  markJustRefreshed(response.cookies);
  return response;
}
