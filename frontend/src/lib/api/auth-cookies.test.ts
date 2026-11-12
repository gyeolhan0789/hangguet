// @vitest-environment node
// 기준: Swagger 1.3 로그인 · 1.4 토큰 재발급 · 2.2 닉네임 변경(TokenResponse · RefreshResponse)
import { describe, expect, it, vi } from "vitest";

import { setAccessTokenCookie } from "./auth-cookies";

// 경계 mock: 쿠키를 쓰는 곳(cookies() · NextResponse.cookies)은 가짜 CookieWriter로 바꾼다
function cookieWriter() {
  return { set: vi.fn(), delete: vi.fn() };
}

// 예시 데이터: Swagger 1.4 200 예시 모양(RefreshResponse)
const TOKENS = { accessToken: "access-1", refreshToken: "refresh-1", expiresIn: 3600 };

describe("setAuthCookies · 로그인 토큰 저장", () => {
  describe("정상 처리", () => {
    it.each([
      { env: "production", secure: true },
      { env: "test", secure: false },
    ])("NODE_ENV가 '$env'이면 Secure 여부는 '$secure'다", async ({ env, secure }) => {
      // Secure 여부는 모듈을 불러올 때 정해지므로 NODE_ENV를 바꾼 뒤 새로 불러온다
      vi.stubEnv("NODE_ENV", env);
      vi.resetModules();
      const { setAuthCookies } = await import("./auth-cookies");
      const writer = cookieWriter();

      setAuthCookies(writer, TOKENS);

      const secureFlags = writer.set.mock.calls.map(([, , options]) => options.secure);
      expect(secureFlags).toEqual([secure, secure]);
    });
  });
});

describe("setAccessTokenCookie · 액세스 토큰만 바꾸기", () => {
  describe("정상 처리", () => {
    it("액세스 토큰 쿠키는 토큰 유효 시간보다 30초 먼저 끝나게 저장한다", () => {
      const writer = cookieWriter();

      setAccessTokenCookie(writer, { accessToken: "access-2", expiresIn: 3600 });

      expect(writer.set).toHaveBeenCalledWith(
        "hk_access",
        "access-2",
        expect.objectContaining({ maxAge: 3570 }),
      );
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "30초", expiresIn: 30 },
      { label: "10초", expiresIn: 10 },
    ])("유효 시간이 '$label'이면 액세스 토큰 쿠키 유효 시간을 0으로 둔다", ({ expiresIn }) => {
      const writer = cookieWriter();

      setAccessTokenCookie(writer, { accessToken: "access-2", expiresIn });

      expect(writer.set).toHaveBeenCalledWith(
        "hk_access",
        "access-2",
        expect.objectContaining({ maxAge: 0 }),
      );
    });
  });
});
