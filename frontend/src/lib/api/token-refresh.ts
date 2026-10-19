import axios from "axios";

import { defaultConfig } from "./config";
import { authEndpoints } from "./endpoints";
import type { TokenResponse } from "./types";

// 1.4 토큰 재발급. proxy(페이지 들어오기 전)와 재발급 Route Handler(화면을 그리는 도중 만료됐을 때)가 같이 쓴다.
// 액세스 토큰이 없어야 하므로 쿠키를 읽는 `api` 대신 별도 인스턴스를 쓴다.
const refreshClient = axios.create(defaultConfig);

// 한 번 쓴 리프레시 토큰은 폐기되므로(API 명세 1.4), 동시에 들어온 요청이 같은 토큰으로
// 재발급을 두 번 부르지 않도록 진행 중인 재발급을 잠시 공유한다.
const pendingRefreshes = new Map<string, Promise<TokenResponse | null>>();
const SHARE_REFRESH_MS = 10_000;

/** 리프레시 토큰으로 새 토큰을 받는다. 실패(REFRESH_TOKEN_INVALID 등)하면 null */
export function refreshTokens(refreshToken: string): Promise<TokenResponse | null> {
  let pending = pendingRefreshes.get(refreshToken);
  if (!pending) {
    pending = refreshClient
      .post<TokenResponse>(authEndpoints.tokenRefresh, { refreshToken })
      .then(({ data }) => data)
      .catch(() => null);
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
