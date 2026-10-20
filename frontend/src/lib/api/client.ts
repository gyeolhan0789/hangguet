import axios from "axios";
import { cookies } from "next/headers";

import { redirectToSignedOut, redirectToTokenRefresh } from "@/lib/auth/auth-errors";
import type { IdempotencyHeaders } from "@/types/api";

import { ACCESS_TOKEN_COOKIE } from "./auth-cookies";
import { defaultConfig } from "./config";
import { getProblemDetail } from "./problem-detail";

// 서버 컴포넌트·서버 액션 전용. next/headers를 쓰므로 클라이언트 컴포넌트에서 불러오면 빌드가 실패한다.
// 액세스 토큰 만료는 요청이 여기 오기 전에 proxy가 재발급해 둔다(src/proxy.ts).
// 그래도 API가 401 TOKEN_EXPIRED를 주면 재발급 Route Handler를 거쳐 이 화면을 다시 그린다(다시 요청).
// 401 UNAUTHORIZED(토큰 없음 · 위조 · 탈퇴)면 쿠키를 지우는 Route Handler를 거쳐 로그인 전 상태로 돌아간다.
export const api = axios.create(defaultConfig);

api.interceptors.request.use(async (config) => {
  const accessToken = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessToken) config.headers.set("Authorization", `Bearer ${accessToken}`);
  return config;
});

api.interceptors.response.use(undefined, async (error: unknown) => {
  const code = getProblemDetail(error)?.code;
  if (code === "TOKEN_EXPIRED") await redirectToTokenRefresh();
  if (code === "UNAUTHORIZED") await redirectToSignedOut();
  throw error;
});

/**
 * 면접 만들기·시작·답변 제출·끝내기(5.1, 5.4, 5.7, 5.8)에 필수인 헤더.
 * 같은 요청을 다시 보낼 때는 처음 만든 키를 그대로 넘긴다.
 */
export function idempotencyHeaders(key: string = crypto.randomUUID()) {
  // 반환 모양은 IdempotencyHeaders(types/api)로 검사하되, axios headers에 넣을 수 있게 객체 리터럴 타입으로 둔다.
  return { "Idempotency-Key": key } satisfies IdempotencyHeaders;
}
