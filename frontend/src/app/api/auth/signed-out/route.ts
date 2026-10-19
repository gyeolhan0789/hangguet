import { NextResponse, type NextRequest } from "next/server";

import { clearAuthCookies } from "@/lib/api/auth-cookies";
import { pathAfterSignedOut } from "@/lib/auth/auth-errors";

// 화면을 그리는 도중 API가 401 UNAUTHORIZED(토큰 없음 · 위조 · 탈퇴)를 주면 여기로 온다(src/lib/auth/auth-errors.ts).
// 남은 토큰 쿠키를 지운다. 쿠키가 남아 있으면 proxy가 로그인 상태로 보고 로그인 화면에도 못 들어가기 때문이다.
// 로그인 없이 보는 화면이면 그 화면으로, 아니면 S01 로그인으로 보낸다.
export function GET(request: NextRequest) {
  const next = pathAfterSignedOut(request.nextUrl.searchParams.get("next"));
  const response = NextResponse.redirect(new URL(next, request.url));
  clearAuthCookies(response.cookies);
  return response;
}
