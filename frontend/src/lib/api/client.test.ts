// @vitest-environment node
// 기준: Swagger 공통 오류(401 UNAUTHORIZED · TOKEN_EXPIRED) · Bearer 인증
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { describe, expect, it, vi } from "vitest";

import { redirectToSignedOut, redirectToTokenRefresh } from "@/lib/auth/auth-errors";
import { axiosProblem, axiosStatusOnly } from "@/test/axios-problem";
import { setCookie } from "@/test/next-headers";
import { RedirectError } from "@/test/next-navigation";

import { api } from "./client";

// 경계 mock: 쿠키(next/headers), 401 뒤 이동(auth-errors), HTTP(어댑터를 바꿔 인터셉터는 진짜로 지나게 한다)
vi.mock("next/headers", () => import("@/test/next-headers"));
vi.mock("@/lib/auth/auth-errors", () => ({
  redirectToTokenRefresh: vi.fn(),
  redirectToSignedOut: vi.fn(),
}));
const adapter = vi.fn<AxiosAdapter>();
api.defaults.adapter = adapter;

// 예시 데이터: Swagger 공통 오류 code(공통 오류는 API별 예시가 없어 모양만 맞춘다)
const TOKEN_EXPIRED = { title: "Unauthorized", status: 401, code: "TOKEN_EXPIRED" };
const UNAUTHORIZED = { title: "Unauthorized", status: 401, code: "UNAUTHORIZED" };
// 예시 데이터: Swagger 8.9 404 예시(code가 있는 401 아닌 실패)
const NOTICE_NOT_FOUND = {
  title: "Not Found",
  status: 404,
  detail: "공지를 찾을 수 없어요.",
  instance: "/api/v1/notices/0/read",
  code: "NOTICE_NOT_FOUND",
};

function ok(config: InternalAxiosRequestConfig): Promise<AxiosResponse> {
  return Promise.resolve({ data: {}, status: 200, statusText: "", headers: {}, config });
}
const sentAuthorization = () => adapter.mock.calls[0][0].headers.get("Authorization");

describe("api · 서버 API 요청", () => {
  describe("토큰 붙이기", () => {
    describe("정상 처리", () => {
      it("액세스 토큰 쿠키의 토큰을 Authorization에 붙인다", async () => {
        setCookie("hk_access", "access-1");
        setCookie("hk_refresh", "refresh-1");
        adapter.mockImplementation(ok);

        await api.get("/users/me");

        expect(sentAuthorization()).toBe("Bearer access-1");
      });
    });

    describe("경계값", () => {
      it("액세스 토큰 쿠키가 없으면 Authorization 없이 보낸다", async () => {
        adapter.mockImplementation(ok);

        await api.get("/users/me");

        expect(sentAuthorization()).toBeUndefined();
      });
    });
  });

  describe("공통 401 처리", () => {
    describe("오류 처리", () => {
      it.each([
        { label: "404 NOTICE_NOT_FOUND", failure: axiosProblem(NOTICE_NOT_FOUND) },
        { label: "본문 없는 502", failure: axiosStatusOnly(502) },
      ])(
        "401이 아닌 실패가 '$label'이면 이동하지 않고 원래 오류를 그대로 던진다",
        async ({ failure }) => {
          adapter.mockRejectedValue(failure);

          await expect(api.get("/users/me")).rejects.toBe(failure);
          expect(redirectToTokenRefresh).not.toHaveBeenCalled();
          expect(redirectToSignedOut).not.toHaveBeenCalled();
        },
      );
    });

    describe("권한 · 로그인", () => {
      it("401 TOKEN_EXPIRED면 재발급 이동을 시작한다", async () => {
        const moveToRefresh = new RedirectError("/api/auth/refresh?next=%2Fhome");
        vi.mocked(redirectToTokenRefresh).mockRejectedValue(moveToRefresh);
        adapter.mockRejectedValue(axiosProblem(TOKEN_EXPIRED));

        await expect(api.get("/users/me")).rejects.toBe(moveToRefresh);
        expect(redirectToSignedOut).not.toHaveBeenCalled();
      });

      it("401 UNAUTHORIZED면 로그인 풀림 이동을 시작한다", async () => {
        const moveToSignedOut = new RedirectError("/api/auth/signed-out?next=%2Fhome");
        vi.mocked(redirectToSignedOut).mockRejectedValue(moveToSignedOut);
        adapter.mockRejectedValue(axiosProblem(UNAUTHORIZED));

        await expect(api.get("/users/me")).rejects.toBe(moveToSignedOut);
        expect(redirectToTokenRefresh).not.toHaveBeenCalled();
      });

      it("재발급 이동 없이 돌아오면(방금 재발급함) 원래 오류를 그대로 던진다", async () => {
        const failure = axiosProblem(TOKEN_EXPIRED);
        vi.mocked(redirectToTokenRefresh).mockResolvedValue(undefined);
        adapter.mockRejectedValue(failure);

        await expect(api.get("/users/me")).rejects.toBe(failure);
        expect(redirectToTokenRefresh).toHaveBeenCalledTimes(1);
      });
    });
  });
});
