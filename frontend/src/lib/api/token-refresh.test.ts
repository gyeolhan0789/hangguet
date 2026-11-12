// @vitest-environment node
// 기준: Swagger 1.4 토큰 재발급(200 · 401 REFRESH_TOKEN_INVALID, 보낸 리프레시 토큰은 다시 쓸 수 없음) · 공통 500
import { beforeEach, describe, expect, it, vi } from "vitest";

import { axiosProblem, axiosStatusOnly } from "@/test/axios-problem";
import { deferred } from "@/test/deferred";
import type { RefreshResponse } from "@/types/api";

import { isAccessTokenExpired } from "./token-refresh";

type TokenRefreshModule = typeof import("./token-refresh");

// 예시 데이터: Swagger 1.4 200 예시 모양(RefreshResponse) · 401 예시
const REFRESHED: RefreshResponse = {
  accessToken: "access-new",
  refreshToken: "refresh-new",
  expiresIn: 3600,
};
const REFRESH_TOKEN_INVALID = {
  title: "Unauthorized",
  status: 401,
  detail: "다시 로그인해 주세요.",
  instance: "/api/v1/auth/token/refresh",
  code: "REFRESH_TOKEN_INVALID",
};

// 2026-11-12T03:00:00Z(초)
const NOW_SECONDS = 1_794_452_400;
const NOW_MS = NOW_SECONDS * 1000;

/** exp 등을 담은 JWT 모양 토큰(서명은 보지 않는다) */
function jwtWith(payload: unknown) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

describe("refreshTokens · 토큰 재발급", () => {
  // 진행 중인 재발급을 모듈 수준 Map에 두므로 테스트마다 새로 불러온다(경계 mock: plainClient.post = HTTP)
  let refreshTokens: TokenRefreshModule["refreshTokens"];
  let post: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const fresh = await import("./token-refresh");
    refreshTokens = fresh.refreshTokens;
    post = vi.spyOn(fresh.plainClient, "post") as unknown as ReturnType<typeof vi.fn>;
  });

  describe("오류 처리", () => {
    it("다시 로그인해야 하면(401 REFRESH_TOKEN_INVALID) null을 돌려준다", async () => {
      post.mockRejectedValue(axiosProblem(REFRESH_TOKEN_INVALID));

      expect(await refreshTokens("refresh-1")).toBeNull();
    });

    it("그 밖의 실패(500)면 그 오류를 던진다", async () => {
      const failure = axiosStatusOnly(500);
      post.mockRejectedValue(failure);

      await expect(refreshTokens("refresh-1")).rejects.toBe(failure);
    });
  });

  describe("중복 · 경쟁 처리", () => {
    it("같은 리프레시 토큰으로 동시에 부르면 한 번만 보내고 같은 결과를 나눈다", async () => {
      const response = deferred<{ data: RefreshResponse }>();
      post.mockReturnValue(response.promise);

      const first = refreshTokens("refresh-1");
      const second = refreshTokens("refresh-1");
      response.resolve({ data: REFRESHED });

      expect(await first).toEqual(REFRESHED);
      expect(await second).toEqual(REFRESHED);
      expect(post).toHaveBeenCalledTimes(1);
    });

    it("무효 판정(null)도 같은 토큰의 다음 요청과 나눈다", async () => {
      post.mockRejectedValue(axiosProblem(REFRESH_TOKEN_INVALID));
      await refreshTokens("refresh-1");

      expect(await refreshTokens("refresh-1")).toBeNull();
      expect(post).toHaveBeenCalledTimes(1);
    });

    it("무효가 아닌 실패는 나누지 않아 다음 요청이 다시 보낸다", async () => {
      post.mockRejectedValueOnce(axiosStatusOnly(500)).mockResolvedValueOnce({ data: REFRESHED });
      await expect(refreshTokens("refresh-1")).rejects.toThrow();

      expect(await refreshTokens("refresh-1")).toEqual(REFRESHED);
      expect(post).toHaveBeenCalledTimes(2);
    });

    it("리프레시 토큰이 다르면 따로 보낸다", async () => {
      post.mockResolvedValue({ data: REFRESHED });

      await Promise.all([refreshTokens("refresh-1"), refreshTokens("refresh-2")]);

      expect(post).toHaveBeenCalledTimes(2);
    });
  });

  describe("시간 경과", () => {
    it("10초가 되기 전이면 끝난 재발급 결과를 다시 쓴다", async () => {
      post.mockResolvedValue({ data: REFRESHED });
      await refreshTokens("refresh-1");

      vi.advanceTimersByTime(9_999);

      expect(await refreshTokens("refresh-1")).toEqual(REFRESHED);
      expect(post).toHaveBeenCalledTimes(1);
    });

    it("10초가 지나면 같은 토큰이어도 다시 보낸다", async () => {
      post.mockResolvedValue({ data: REFRESHED });
      await refreshTokens("refresh-1");

      vi.advanceTimersByTime(10_000);
      await refreshTokens("refresh-1");

      expect(post).toHaveBeenCalledTimes(2);
    });
  });
});

describe("isAccessTokenExpired · 액세스 토큰 만료 판단", () => {
  describe("정상 처리", () => {
    it("본문에 base64url 문자(-, _)가 있어도 exp를 읽는다", () => {
      // 본문 'eyJzdWIiOiJ-fn4_Pz4i…'에 '-'와 '_'가 모두 든다(sub "~~~??>", exp = 지금 - 60초)
      const token = jwtWith({ sub: "~~~??>", exp: NOW_SECONDS - 60 });

      expect(isAccessTokenExpired(token, NOW_MS)).toBe(true);
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "JWT 모양 아님", token: "not-a-jwt" },
      {
        label: "본문이 JSON 아님",
        token: `header.${Buffer.from("not-json").toString("base64url")}.s`,
      },
      { label: "exp 없음", token: jwtWith({ sub: "user-1" }) },
      { label: "exp가 숫자 아님", token: jwtWith({ exp: String(NOW_SECONDS - 60) }) },
    ])("토큰이 '$label'이면 만료로 판단하지 않는다", ({ token }) => {
      expect(isAccessTokenExpired(token, NOW_MS)).toBe(false);
    });
  });

  describe("경계값", () => {
    it.each([
      { left: 30, expired: true },
      { left: 31, expired: false },
    ])("exp까지 '$left'초 남았으면 만료 여부는 '$expired'다", ({ left, expired }) => {
      expect(isAccessTokenExpired(jwtWith({ exp: NOW_SECONDS + left }), NOW_MS)).toBe(expired);
    });
  });
});
