import { cookies } from "next/headers";
import { cache } from "react";

import { ACCESS_TOKEN_COOKIE } from "@/lib/api/auth-cookies";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail, type UserResponse } from "@/lib/api/types";

/**
 * 로그인한 회원의 내 정보(2.1). 로그인하지 않았거나 토큰이 무효면 null.
 * 한 요청 안에서 여러 번 불러도 API는 한 번만 부른다. 쿠키를 읽으므로 `<Suspense>` 안에서 쓴다.
 */
export const getMe = cache(async (): Promise<UserResponse | null> => {
  if (!(await cookies()).has(ACCESS_TOKEN_COOKIE)) return null;
  try {
    const { data } = await api.get<UserResponse>(endpoints.users.me);
    return data;
  } catch (error) {
    if (getProblemDetail(error)?.status === 401) return null;
    throw error;
  }
});
