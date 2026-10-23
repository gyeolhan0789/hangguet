// @vitest-environment node
import { NextRequest, type NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RefreshResponse } from "@/types/api";

// 기준: src/lib/auth/auth-errors.ts(401 TOKEN_EXPIRED → 1.4로 재발급하고 next로) · 웹 Swagger 1.4 토큰 재발급
// standalone 컨테이너에서는 request.url이 https://0.0.0.0:3000이라, 그 주소로 절대 리다이렉트하면 브라우저가 못 간다.
const CONTAINER = "https://0.0.0.0:3000";

// 1.4 호출 경계만 바꾼다. 실패 응답(REFRESH_TOKEN_INVALID → null)은 token-refresh 테스트가 본다.
const { refreshTokens } = vi.hoisted(() => ({
  refreshTokens: vi.fn<(token: string) => Promise<RefreshResponse | null>>(),
}));
vi.mock("@/lib/api/token-refresh", () => ({ refreshTokens }));

const { GET } = await import("./route");

const TOKENS = {
  accessToken: "access-2",
  refreshToken: "refresh-2",
  expiresIn: 3600,
} satisfies RefreshResponse;

beforeEach(() => {
  vi.resetAllMocks();
});

function request(next: string, cookie = "hk_refresh=refresh-1") {
  return new NextRequest(`${CONTAINER}/api/auth/refresh?next=${encodeURIComponent(next)}`, {
    headers: { cookie },
  });
}

function expectTokenCookiesCleared(response: NextResponse) {
  for (const name of ["hk_access", "hk_refresh"]) {
    expect(response.cookies.get(name)?.value).toBe("");
  }
}

describe("GET /api/auth/refresh", () => {
  it("재발급되면 요청 주소가 컨테이너 주소여도 Location은 원래 경로만 나가고 새 토큰을 저장한다", async () => {
    refreshTokens.mockResolvedValue(TOKENS);

    const response = await GET(request("/records?page=2"));

    expect(refreshTokens).toHaveBeenCalledWith("refresh-1");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/records?page=2");
    expect(response.cookies.get("hk_access")?.value).toBe("access-2");
    expect(response.cookies.get("hk_refresh")?.value).toBe("refresh-2");
    // 방금 재발급했음을 남겨 돌아간 화면에서 재발급을 반복하지 않게 한다
    expect(response.cookies.get("hk_refreshed")?.value).toBe("1");
  });

  it("다시 로그인해야 하면 next가 로그인 없이 보는 화면이어도 쿠키를 지우고 /login으로만 보낸다", async () => {
    refreshTokens.mockResolvedValue(null);

    const response = await GET(request("/"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/login");
    expectTokenCookiesCleared(response);
    expect(response.cookies.get("hk_access")?.expires).toEqual(new Date(0));
  });

  it("리프레시 토큰 쿠키가 없으면 1.4를 부르지 않고 쿠키를 지운 뒤 /login으로 보낸다", async () => {
    const response = await GET(request("/home", ""));

    expect(refreshTokens).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/login");
    expectTokenCookiesCleared(response);
  });

  it("그 밖의 실패(500 · 연결 오류)는 쿠키를 두고 오류로 넘긴다", async () => {
    refreshTokens.mockRejectedValue(new Error("연결 오류"));

    await expect(GET(request("/home"))).rejects.toThrow("연결 오류");
  });

  it("다른 사이트로 가는 next면 홈 경로로 보낸다", async () => {
    refreshTokens.mockResolvedValue(TOKENS);

    expect((await GET(request("//evil.example"))).headers.get("location")).toBe("/home");
    expect((await GET(request("/\t/evil.example"))).headers.get("location")).toBe("/home");
  });

  it("한글이 든 next도 인코딩한 경로로 보낸다", async () => {
    refreshTokens.mockResolvedValue(TOKENS);

    const response = await GET(request("/records?q=한끗"));

    expect(response.headers.get("location")).toBe("/records?q=%ED%95%9C%EB%81%97");
  });
});
