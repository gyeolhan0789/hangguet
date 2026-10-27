import { cookies } from "next/headers";
import { cache } from "react";

import { ACCESS_TOKEN_COOKIE } from "@/lib/api/auth-cookies";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail } from "@/lib/api/problem-detail";
import type { MeResponse } from "@/types/api";

/**
 * 로그인한 회원의 내 정보(2.1). 로그인하지 않았거나 토큰이 무효면 null.
 * 한 요청 안에서 여러 번 불러도 API는 한 번만 부른다. 쿠키를 읽으므로 `<Suspense>` 안에서 쓴다.
 */
export const getMe = cache(async (): Promise<MeResponse | null> => {
  if (!(await cookies()).has(ACCESS_TOKEN_COOKIE)) return null;
  try {
    const { data } = await api.get<MeResponse>(endpoints.users.me);
    return data;
  } catch (error) {
    // 웹 Swagger 공통 401(UNAUTHORIZED · TOKEN_EXPIRED). 실패는 HTTP 상태가 아니라 code로 구분한다.
    const code = getProblemDetail(error)?.code;
    if (code === "UNAUTHORIZED" || code === "TOKEN_EXPIRED") return null;
    throw error;
  }
});
