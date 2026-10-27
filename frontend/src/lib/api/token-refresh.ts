import axios from "axios";

import type { RefreshResponse } from "@/types/api";

import { defaultConfig } from "./config";
import { authEndpoints } from "./endpoints";
import { getProblemDetail } from "./problem-detail";

// 1.4 토큰 재발급. proxy(페이지 들어오기 전)와 재발급 Route Handler(화면을 그리는 도중 만료됐을 때)가 같이 쓴다.
// 쿠키를 읽고 401이면 화면을 옮기는 `api`의 인터셉터를 거치면 안 되는 요청(1.4 재발급 · 1.5 로그아웃)은 이 인스턴스로 보낸다.
export const plainClient = axios.create(defaultConfig);

// 보낸 리프레시 토큰은 다시 쓸 수 없으므로(웹 Swagger 1.4), 동시에 들어온 요청이 같은 토큰으로
// 재발급을 두 번 부르지 않도록 진행 중인 재발급과 그 결과(새 토큰 · 무효)를 잠시 공유한다.
const pendingRefreshes = new Map<string, Promise<RefreshResponse | null>>();
const SHARE_REFRESH_MS = 10_000;

/**
 * 리프레시 토큰으로 새 토큰을 받는다.
 * 다시 로그인해야 하는 실패(웹 Swagger 1.4 401 REFRESH_TOKEN_INVALID)면 null.
 * 그 밖의 실패(공통 500 INTERNAL_ERROR · 연결 오류 등)는 그대로 던지고, 그 결과는 공유하지 않는다(다음 요청이 다시 시도).
 */
export function refreshTokens(refreshToken: string): Promise<RefreshResponse | null> {
  let pending = pendingRefreshes.get(refreshToken);
  if (!pending) {
    pending = plainClient
      .post<RefreshResponse>(authEndpoints.tokenRefresh, { refreshToken })
      .then(({ data }) => data)
      .catch((error: unknown) => {
        if (getProblemDetail(error)?.code === "REFRESH_TOKEN_INVALID") return null;
        pendingRefreshes.delete(refreshToken);
        throw error;
      });
    pendingRefreshes.set(refreshToken, pending);
    setTimeout(() => pendingRefreshes.delete(refreshToken), SHARE_REFRESH_MS);
  }
  return pending;
}

/** 만료 직전도 만료로 본다(요청이 가는 동안 끝나지 않게) */
const EXPIRY_MARGIN_SECONDS = 30;

/**
 * 액세스 토큰(JWT)의 `exp`가 지났거나 곧 끝나는지. 서명은 BE가 검증하므로 여기서는 시간만 본다.
 * JWT 모양이 아니거나 `exp`가 없으면 판단하지 않는다(false).
 */
export function isAccessTokenExpired(token: string, now: number = Date.now()): boolean {
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json) as { exp?: unknown };
    return typeof exp === "number" && exp - EXPIRY_MARGIN_SECONDS <= now / 1000;
  } catch {
    return false;
  }
}
