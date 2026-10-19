import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { PUBLIC_PATHS, ROUTES } from "@/lib/routes";

// API 명세 1장 공통 오류(401) 처리. 서버 컴포넌트는 쿠키를 쓸 수 없으므로(Next 문서 cookies),
// 쿠키를 바꿔야 하는 일은 Route Handler로 보내 처리하고 화면으로 돌아오게 한다.
// - TOKEN_EXPIRED(만료): 재발급한 뒤 다시 요청한다 → /api/auth/refresh
// - UNAUTHORIZED(토큰 없음 · 위조 · 탈퇴): 쿠키를 지운다 → /api/auth/signed-out

/** proxy가 지금 화면 주소(경로 + 쿼리)를 서버 컴포넌트에 넘겨주는 요청 헤더 */
export const PATHNAME_HEADER = "x-hk-pathname";

/** 재발급 Route Handler가 방금 재발급했다고 남기는 쿠키. 그래도 만료라고 하면 재발급을 반복하지 않는다. */
export const JUST_REFRESHED_COOKIE = "hk_refreshed";
export const JUST_REFRESHED_MAX_AGE_SECONDS = 10;

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

/** API가 401 TOKEN_EXPIRED를 줬을 때. 방금 재발급했다면 아무것도 하지 않고 원래 오류를 그대로 둔다. */
export async function redirectToTokenRefresh(): Promise<void> {
  if ((await cookies()).has(JUST_REFRESHED_COOKIE)) return;
  redirect(`${ROUTES.tokenRefresh}?next=${encodeURIComponent(await currentPath())}`);
}

/** API가 401 UNAUTHORIZED를 줬을 때: 쿠키를 지우고 로그인 전 상태로 돌아간다. */
export async function redirectToSignedOut(): Promise<void> {
  redirect(`${ROUTES.signedOut}?next=${encodeURIComponent(await currentPath())}`);
}
