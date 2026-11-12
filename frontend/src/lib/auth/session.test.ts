// @vitest-environment node
// 기준: Swagger 2.1 내 정보 · 공통 오류(401 UNAUTHORIZED · TOKEN_EXPIRED)
import { describe, expect, it, vi } from "vitest";

import { axiosProblem } from "@/test/axios-problem";
import { setCookie } from "@/test/next-headers";
import { RedirectError } from "@/test/next-navigation";

import { getMe } from "./session";

// 경계 mock: HTTP(api)와 쿠키(next/headers)
const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api/client", () => ({ api }));
vi.mock("next/headers", () => import("@/test/next-headers"));

// 예시 데이터: Swagger 공통 401(API별 예시가 없어 모양만 맞춘다)
const TOKEN_EXPIRED = { title: "Unauthorized", status: 401, code: "TOKEN_EXPIRED" };

describe("getMe · 내 정보", () => {
  describe("권한 · 로그인", () => {
    it("토큰 쿠키가 없으면 요청하지 않고 null을 돌려준다", async () => {
      expect(await getMe()).toBeNull();
      expect(api.get).not.toHaveBeenCalled();
    });

    it("방금 재발급했는데도 토큰 만료(401 TOKEN_EXPIRED)로 돌아오면 null을 돌려준다", async () => {
      setCookie("hk_access", "access-1");
      api.get.mockRejectedValue(axiosProblem(TOKEN_EXPIRED));

      expect(await getMe()).toBeNull();
    });

    it("토큰 재발급 · 로그아웃으로 이동해야 하면 그 이동을 그대로 던진다", async () => {
      setCookie("hk_access", "access-1");
      const moveToRefresh = new RedirectError("/api/auth/refresh");
      api.get.mockRejectedValue(moveToRefresh);

      await expect(getMe()).rejects.toBe(moveToRefresh);
    });
  });
});
