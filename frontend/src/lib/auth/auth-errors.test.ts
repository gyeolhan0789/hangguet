// @vitest-environment node
// 기준: Swagger 공통 오류(401 UNAUTHORIZED · TOKEN_EXPIRED) · 1.4 토큰 재발급(REFRESH_TOKEN_INVALID) · Next 문서 cookies · redirect
import { describe, expect, it, vi } from "vitest";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { refreshTokens } from "@/lib/api/token-refresh";
import { axiosNoResponse } from "@/test/axios-problem";
import { cookieValue, setCookie } from "@/test/next-headers";
import { redirectTo } from "@/test/redirect";

import {
  pathAfterSignedOut,
  redirectToSignedOut,
  redirectToTokenRefresh,
  safeNextPath,
} from "./auth-errors";

// 경계 mock: Next 런타임(쿠키 · 요청 헤더 · redirect)과 재발급 요청(1.4)
vi.mock("next/headers", () => import("@/test/next-headers"));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
vi.mock("@/lib/api/token-refresh", () => ({ refreshTokens: vi.fn() }));

// 예시 데이터: Swagger 1.4 200 예시 모양(RefreshResponse)
const REFRESHED = { accessToken: "access-new", refreshToken: "refresh-new", expiresIn: 3600 };

/** proxy가 넘겨주는 요청 헤더(지금 화면 주소 · 서버 액션 표시) */
function requestHeaders(values: { path?: string; serverAction?: boolean }) {
  const init: Record<string, string> = {};
  if (values.path) init["x-hk-pathname"] = values.path;
  init["x-hk-server-action"] = values.serverAction ? "1" : "0";
  vi.mocked(headers).mockResolvedValue(new Headers(init));
}

function signedIn() {
  setCookie("hk_access", "access-1");
  setCookie("hk_refresh", "refresh-1");
}

describe("safeNextPath · 돌아갈 주소 고르기", () => {
  describe("정상 처리", () => {
    it("이 사이트 안의 경로 · 쿼리 · 해시는 그대로 돌려준다", () => {
      expect(safeNextPath("/records?date=2026-11-12#list")).toBe("/records?date=2026-11-12#list");
    });
  });

  describe("입력 검증", () => {
    it.each([
      { label: "null", next: null },
      { label: "/로 시작 안 함", next: "records" },
      { label: "//evil.com", next: "//evil.com" },
      { label: String.raw`/\evil.com`, next: String.raw`/\evil.com` },
      { label: String.raw`/\t/evil.com`, next: "/\t/evil.com" },
    ])("돌아갈 주소가 '$label'이면 홈을 돌려준다", ({ next }) => {
      expect(safeNextPath(next)).toBe("/home");
    });
  });
});

describe("pathAfterSignedOut · 로그인이 풀린 뒤 갈 곳", () => {
  describe("정상 처리", () => {
    it("로그인 없이 보는 화면이면 쿼리까지 그대로 그 화면에 머문다", () => {
      expect(pathAfterSignedOut("/inquiries/guest?inquiryId=7")).toBe(
        "/inquiries/guest?inquiryId=7",
      );
    });
  });

  describe("권한 · 로그인", () => {
    it("로그인이 필요한 화면이면 로그인 화면을 돌려준다", () => {
      expect(pathAfterSignedOut("/mypage")).toBe("/login");
    });
  });
});

describe("redirectToTokenRefresh · 토큰 만료 처리", () => {
  describe("화면 그리기 중", () => {
    describe("경계값", () => {
      it("지금 주소를 모르면 홈을 next로 붙인다", async () => {
        requestHeaders({});

        await expect(redirectToTokenRefresh()).rejects.toThrow(
          redirectTo("/api/auth/refresh?next=%2Fhome"),
        );
      });
    });

    describe("권한 · 로그인", () => {
      it("지금 주소를 next로 붙여 재발급 Route Handler로 보낸다", async () => {
        requestHeaders({ path: "/records?date=2026-11-12" });

        await expect(redirectToTokenRefresh()).rejects.toThrow(
          redirectTo("/api/auth/refresh?next=%2Frecords%3Fdate%3D2026-11-12"),
        );
      });
    });
  });

  describe("서버 액션 중", () => {
    describe("오류 처리", () => {
      it("재발급이 일시 실패하면 그 오류를 던지고 쿠키는 그대로 둔다", async () => {
        signedIn();
        requestHeaders({ path: "/practice/mode", serverAction: true });
        const failure = axiosNoResponse();
        vi.mocked(refreshTokens).mockRejectedValue(failure);

        await expect(redirectToTokenRefresh()).rejects.toBe(failure);
        expect(cookieValue("hk_access")).toBe("access-1");
        expect(cookieValue("hk_refresh")).toBe("refresh-1");
      });
    });

    describe("권한 · 로그인", () => {
      it("직접 재발급해 새 토큰과 방금 재발급 표시를 저장하고 지금 화면으로 다시 보낸다", async () => {
        signedIn();
        requestHeaders({ path: "/practice/mode?applicationId=12", serverAction: true });
        vi.mocked(refreshTokens).mockResolvedValue(REFRESHED);

        await expect(redirectToTokenRefresh()).rejects.toThrow(
          redirectTo("/practice/mode?applicationId=12"),
        );
        expect(refreshTokens).toHaveBeenCalledWith("refresh-1");
        expect(cookieValue("hk_access")).toBe("access-new");
        expect(cookieValue("hk_refresh")).toBe("refresh-new");
        expect(cookieValue("hk_refreshed")).toBe("1");
      });

      it("재발급이 무효면 토큰 쿠키를 지우고 로그인 화면으로 보낸다", async () => {
        signedIn();
        requestHeaders({ path: "/practice/mode", serverAction: true });
        vi.mocked(refreshTokens).mockResolvedValue(null);

        await expect(redirectToTokenRefresh()).rejects.toThrow(redirectTo("/login"));
        expect(cookieValue("hk_access")).toBeUndefined();
        expect(cookieValue("hk_refresh")).toBeUndefined();
      });

      it("리프레시 토큰 쿠키가 없으면 재발급하지 않고 로그인 화면으로 보낸다", async () => {
        setCookie("hk_access", "access-1");
        requestHeaders({ path: "/practice/mode", serverAction: true });

        await expect(redirectToTokenRefresh()).rejects.toThrow(redirectTo("/login"));
        expect(refreshTokens).not.toHaveBeenCalled();
      });
    });
  });

  describe("재발급 반복 막기", () => {
    describe("중복 · 경쟁 처리", () => {
      it("방금 재발급했으면 다시 재발급하지 않고 이동 없이 돌아온다", async () => {
        signedIn();
        setCookie("hk_refreshed", "1");
        requestHeaders({ path: "/practice/mode", serverAction: true });

        await expect(redirectToTokenRefresh()).resolves.toBeUndefined();
        expect(refreshTokens).not.toHaveBeenCalled();
        expect(redirect).not.toHaveBeenCalled();
      });
    });
  });
});

describe("redirectToSignedOut · 로그인 풀림 처리", () => {
  describe("화면 그리기 중", () => {
    describe("권한 · 로그인", () => {
      it("지금 주소를 next로 붙여 쿠키를 지우는 Route Handler로 보낸다", async () => {
        requestHeaders({ path: "/mypage?month=2026-11" });

        await expect(redirectToSignedOut()).rejects.toThrow(
          redirectTo("/api/auth/signed-out?next=%2Fmypage%3Fmonth%3D2026-11"),
        );
      });
    });
  });

  describe("서버 액션 중", () => {
    describe("권한 · 로그인", () => {
      it("토큰 쿠키를 직접 지우고 로그인 화면으로 보낸다", async () => {
        signedIn();
        requestHeaders({ path: "/mypage", serverAction: true });

        await expect(redirectToSignedOut()).rejects.toThrow(redirectTo("/login"));
        expect(cookieValue("hk_access")).toBeUndefined();
        expect(cookieValue("hk_refresh")).toBeUndefined();
      });
    });
  });
});
