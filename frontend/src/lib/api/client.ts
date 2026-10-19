import axios from "axios";
import { cookies } from "next/headers";

import { ACCESS_TOKEN_COOKIE } from "./auth-cookies";
import { defaultConfig } from "./config";

// 서버 컴포넌트·서버 액션 전용. next/headers를 쓰므로 클라이언트 컴포넌트에서 불러오면 빌드가 실패한다.
// 액세스 토큰 만료는 요청이 여기 오기 전에 proxy가 재발급해 둔다(src/proxy.ts).
export const api = axios.create(defaultConfig);

api.interceptors.request.use(async (config) => {
  const accessToken = (await cookies()).get(ACCESS_TOKEN_COOKIE)?.value;
  if (accessToken) config.headers.set("Authorization", `Bearer ${accessToken}`);
  return config;
});

/**
 * 면접 만들기·시작·답변 제출·끝내기(5.1, 5.4, 5.7, 5.8)에 필수인 헤더.
 * 같은 요청을 다시 보낼 때는 처음 만든 키를 그대로 넘긴다.
 */
export function idempotencyHeaders(key: string = crypto.randomUUID()) {
  return { "Idempotency-Key": key };
}
