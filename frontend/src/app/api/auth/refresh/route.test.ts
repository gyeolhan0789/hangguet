// @vitest-environment node
// 기준: src/lib/auth/auth-errors.ts(401 TOKEN_EXPIRED면 1.4로 재발급하고 next로) · 웹 Swagger 1.4 토큰 재발급
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/api/auth-cookies";
import { JUST_REFRESHED_COOKIE } from "@/lib/auth/auth-errors";
import type { RefreshResponse } from "@/types/api";

import { GET } from "./route";

// 경계 mock: 1.4 재발급 호출(실패 응답을 null로 바꾸는 판정은 token-refresh 테스트가 본다)
const { refreshTokens } = vi.hoisted(() => ({
  refreshTokens: vi.fn<(token: string) => Promise<RefreshResponse | null>>(),
}));
vi.mock("@/lib/api/token-refresh", () => ({ refreshTokens }));

// standalone 컨테이너에서는 request.url이 이 주소다(절대 주소로 보내면 브라우저가 가지 못한다)
const CONTAINER = "https://0.0.0.0:3000";

// 예시 데이터: Swagger 1.4 200 예시 모양
const TOKENS: RefreshResponse = {
  accessToken: "access-2",
  refreshToken: "refresh-2",
  expiresIn: 3600,
};

function request(next: string, cookie = `${REFRESH_TOKEN_COOKIE}=refresh-1`) {
  return new NextRequest(`${CONTAINER}/api/auth/refresh?next=${encodeURIComponent(next)}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("GET · 재발급 Route Handler", () => {
  describe("정상 처리", () => {
    it("재발급하면 새 토큰과 방금 재발급 표시를 저장하고 Location에 원래 경로만 넣어 보낸다", async () => {
      refreshTokens.mockResolvedValue(TOKENS);

      const response = await GET(request("/records?page=2"));

      expect(response.headers.get("location")).toBe("/records?page=2");
      expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("access-2");
      expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("refresh-2");
      expect(response.cookies.get(JUST_REFRESHED_COOKIE)?.value).toBe("1");
    });
  });

  describe("입력 검증", () => {
    it("next가 다른 사이트 주소면 홈으로 보낸다", async () => {
      refreshTokens.mockResolvedValue(TOKENS);

      const response = await GET(request("//evil.example"));

      expect(response.headers.get("location")).toBe("/home");
    });
  });

  describe("오류 처리", () => {
    it("재발급이 일시 실패하면 쿠키를 두고 오류를 던진다", async () => {
      const failure = new Error("연결 오류");
      refreshTokens.mockRejectedValue(failure);

      await expect(GET(request("/home"))).rejects.toBe(failure);
    });
  });

  describe("권한 · 로그인", () => {
    it("다시 로그인해야 하면 next와 상관없이 토큰 쿠키를 지우고 로그인 화면으로 보낸다", async () => {
      refreshTokens.mockResolvedValue(null);

      const response = await GET(request("/"));

      expect(response.headers.get("location")).toBe("/login");
      expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
      expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("");
    });

    it("리프레시 토큰 쿠키가 없으면 재발급하지 않고 쿠키를 지운 뒤 로그인 화면으로 보낸다", async () => {
      const response = await GET(request("/home", ""));

      expect(refreshTokens).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toBe("/login");
      expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
      expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("");
    });
  });
});
