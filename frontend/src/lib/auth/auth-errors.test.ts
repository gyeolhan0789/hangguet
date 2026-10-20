// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RefreshResponse } from "@/types/api";

// 요청 헤더(proxy가 넘긴 주소 · 서버 액션 표시)와 쿠키
const requestHeaders = new Map<string, string>();
const cookieJar = new Map<string, string>();
const cookieStore = {
  has: (name: string) => cookieJar.has(name),
  get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
  set: vi.fn((name: string, value: string) => void cookieJar.set(name, value)),
  delete: vi.fn((name: string) => void cookieJar.delete(name)),
};
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => requestHeaders.get(name) ?? null }),
  cookies: async () => cookieStore,
}));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const refreshTokens = vi.fn<(token: string) => Promise<RefreshResponse | null>>();
vi.mock("@/lib/api/token-refresh", () => ({
  refreshTokens: (token: string) => refreshTokens(token),
}));

const { pathAfterSignedOut, redirectToSignedOut, redirectToTokenRefresh, safeNextPath } =
  await import("./auth-errors");

beforeEach(() => {
  vi.clearAllMocks();
  requestHeaders.clear();
  cookieJar.clear();
  requestHeaders.set("x-hk-pathname", "/practice/mode?applicationId=10");
});

const asServerAction = () => requestHeaders.set("x-hk-server-action", "1");

describe("safeNextPath (재발급 뒤 돌아갈 주소)", () => {
  it("이 사이트 안의 경로 · 쿼리는 그대로", () => {
    expect(safeNextPath("/home")).toBe("/home");
    expect(safeNextPath("/records?page=2")).toBe("/records?page=2");
  });

  it("없거나 다른 사이트로 가는 주소면 홈", () => {
    expect(safeNextPath(null)).toBe("/home");
    expect(safeNextPath("")).toBe("/home");
    expect(safeNextPath("https://evil.example")).toBe("/home");
    expect(safeNextPath("//evil.example")).toBe("/home");
    expect(safeNextPath("/\\evil.example")).toBe("/home");
  });
});

describe("pathAfterSignedOut (UNAUTHORIZED로 쿠키를 지운 뒤 갈 곳)", () => {
  it("로그인 없이 보는 화면이면 그 화면에 머문다", () => {
    expect(pathAfterSignedOut("/")).toBe("/");
    expect(pathAfterSignedOut("/signup")).toBe("/signup");
  });

  it("로그인이 필요한 화면이면 S01 로그인", () => {
    expect(pathAfterSignedOut("/home")).toBe("/login");
    expect(pathAfterSignedOut("/records?page=2")).toBe("/login");
  });

  it("다른 사이트 주소는 받지 않는다", () => {
    expect(pathAfterSignedOut("//evil.example")).toBe("/login");
  });
});

describe("redirectToSignedOut (401 UNAUTHORIZED)", () => {
  it("화면을 그리는 중이면 쿠키를 지우는 Route Handler로 보낸다", async () => {
    await expect(redirectToSignedOut()).rejects.toThrow(
      "REDIRECT /api/auth/signed-out?next=%2Fpractice%2Fmode%3FapplicationId%3D10",
    );
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("서버 액션이면 쿠키를 직접 지우고 로그인 화면으로 보낸다(서버 액션의 redirect는 Route Handler에 닿지 않는다)", async () => {
    asServerAction();
    cookieJar.set("hk_access", "a").set("hk_refresh", "r");

    await expect(redirectToSignedOut()).rejects.toThrow("REDIRECT /login");
    expect([...cookieJar.keys()]).toEqual([]);
  });
});

describe("redirectToTokenRefresh (401 TOKEN_EXPIRED)", () => {
  it("화면을 그리는 중이면 재발급 Route Handler로 보낸다", async () => {
    await expect(redirectToTokenRefresh()).rejects.toThrow(
      "REDIRECT /api/auth/refresh?next=%2Fpractice%2Fmode%3FapplicationId%3D10",
    );
    expect(refreshTokens).not.toHaveBeenCalled();
  });

  it("방금 재발급했으면 아무것도 하지 않는다(재발급을 반복하지 않음)", async () => {
    cookieJar.set("hk_refreshed", "1");

    await expect(redirectToTokenRefresh()).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("서버 액션이면 직접 재발급해 쿠키에 저장하고 지금 화면을 다시 그린다", async () => {
    asServerAction();
    cookieJar.set("hk_refresh", "refresh-1");
    refreshTokens.mockResolvedValue({
      accessToken: "access-2",
      refreshToken: "refresh-2",
      expiresIn: 3600,
    });

    await expect(redirectToTokenRefresh()).rejects.toThrow(
      "REDIRECT /practice/mode?applicationId=10",
    );
    expect(refreshTokens).toHaveBeenCalledWith("refresh-1");
    expect(cookieJar.get("hk_access")).toBe("access-2");
    expect(cookieJar.get("hk_refresh")).toBe("refresh-2");
    expect(cookieJar.has("hk_refreshed")).toBe(true);
  });

  it("서버 액션에서 재발급도 안 되면 쿠키를 지우고 로그인 화면으로 보낸다", async () => {
    asServerAction();
    cookieJar.set("hk_access", "a").set("hk_refresh", "bad");
    refreshTokens.mockResolvedValue(null);

    await expect(redirectToTokenRefresh()).rejects.toThrow("REDIRECT /login");
    expect([...cookieJar.keys()]).toEqual([]);
  });
});
