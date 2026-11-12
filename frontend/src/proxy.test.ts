// @vitest-environment node
// 기준: Swagger 1.4 토큰 재발급(200 · 401 REFRESH_TOKEN_INVALID) · Next 문서 proxy · mutating-data
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { refreshTokens } from "@/lib/api/token-refresh";
import { axiosStatusOnly } from "@/test/axios-problem";

import { proxy } from "./proxy";

// 경계 mock: 재발급 요청(1.4)만 바꾼다. 만료 판단(isAccessTokenExpired)은 진짜로 돈다
vi.mock("@/lib/api/token-refresh", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/token-refresh")>()),
  refreshTokens: vi.fn(),
}));

// 예시 데이터: Swagger 1.4 200 예시 모양(RefreshResponse)
const REFRESHED = { accessToken: "access-new", refreshToken: "refresh-new", expiresIn: 3600 };

const NOW = Date.parse("2026-11-12T03:00:00Z");

/** exp만 든 JWT 모양 토큰(서명은 proxy가 보지 않는다) */
function jwt(exp: number) {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.signature`;
}
const VALID_ACCESS = jwt(NOW / 1000 + 3600);
const EXPIRED_ACCESS = jwt(NOW / 1000 - 60);

function requestTo(
  path: string,
  cookie = "",
  init: { method?: string; headers?: Record<string, string> } = {},
) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: { cookie, ...init.headers },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("proxy · 페이지 앞 로그인 확인", () => {
  describe("토큰 재발급", () => {
    describe("정상 처리", () => {
      it("액세스 토큰이 아직 유효하면 재발급하지 않고 그대로 그린다", async () => {
        const response = await proxy(
          requestTo("/home", `hk_access=${VALID_ACCESS}; hk_refresh=refresh-1`),
        );

        expect(refreshTokens).not.toHaveBeenCalled();
        expect(response.headers.get("location")).toBeNull();
      });

      it("액세스 토큰이 만료됐으면 리프레시 토큰으로 재발급한다", async () => {
        vi.mocked(refreshTokens).mockResolvedValue(REFRESHED);

        await proxy(requestTo("/home", `hk_access=${EXPIRED_ACCESS}; hk_refresh=refresh-1`));

        expect(refreshTokens).toHaveBeenCalledTimes(1);
        expect(refreshTokens).toHaveBeenCalledWith("refresh-1");
      });

      it("액세스 토큰 쿠키가 없고 리프레시 토큰이 있으면 재발급해 새 토큰을 응답 쿠키에 저장한다", async () => {
        vi.mocked(refreshTokens).mockResolvedValue(REFRESHED);

        const response = await proxy(requestTo("/home", "hk_refresh=refresh-1"));

        expect(response.cookies.get("hk_access")?.value).toBe("access-new");
        expect(response.cookies.get("hk_refresh")?.value).toBe("refresh-new");
      });

      it("재발급하면 이번 요청의 화면도 새 토큰을 읽도록 요청 쿠키를 바꾼다", async () => {
        vi.mocked(refreshTokens).mockResolvedValue(REFRESHED);

        const response = await proxy(requestTo("/home", "hk_refresh=refresh-1"));

        const forwardedCookie = response.headers.get("x-middleware-request-cookie");
        expect(forwardedCookie).toContain("hk_access=access-new");
        expect(forwardedCookie).toContain("hk_refresh=refresh-new");
      });
    });

    describe("오류 처리", () => {
      it("재발급이 무효(null)면 응답의 토큰 쿠키를 지운다", async () => {
        vi.mocked(refreshTokens).mockResolvedValue(null);

        const response = await proxy(requestTo("/home", "hk_refresh=refresh-bad"));

        expect(response.cookies.get("hk_access")?.value).toBe("");
        expect(response.cookies.get("hk_refresh")?.value).toBe("");
      });

      it("재발급이 무효면 이번 요청의 화면도 토큰 없이 그리도록 요청 쿠키를 지운다", async () => {
        vi.mocked(refreshTokens).mockResolvedValue(null);

        const response = await proxy(requestTo("/terms", "theme=dark; hk_refresh=refresh-bad"));

        expect(response.headers.get("x-middleware-request-cookie")).toBe("theme=dark");
      });

      it("재발급이 무효가 아닌 이유로 실패하면 토큰 쿠키를 지우지 않는다", async () => {
        vi.mocked(refreshTokens).mockRejectedValue(axiosStatusOnly(500));

        const response = await proxy(requestTo("/home", "hk_refresh=refresh-1"));

        expect(response.cookies.get("hk_access")).toBeUndefined();
        expect(response.cookies.get("hk_refresh")).toBeUndefined();
      });
    });
  });

  describe("접근 제어", () => {
    describe("권한 · 로그인", () => {
      it("로그인하지 않았으면 로그인이 필요한 화면에서 로그인 화면으로 보낸다", async () => {
        const response = await proxy(requestTo("/home"));

        expect(response.headers.get("location")).toBe("http://localhost:3000/login");
      });

      it("로그인 없이 보는 화면이면 로그인하지 않아도 그대로 보여 준다", async () => {
        const response = await proxy(requestTo("/terms"));

        expect(response.headers.get("location")).toBeNull();
      });

      it("재발급이 무효면 로그인이 필요한 화면에서 로그인 화면으로 보낸다", async () => {
        vi.mocked(refreshTokens).mockResolvedValue(null);

        const response = await proxy(requestTo("/home", "hk_refresh=refresh-bad"));

        expect(response.headers.get("location")).toBe("http://localhost:3000/login");
      });

      it("재발급이 일시 실패하면 로그인 화면으로 보내지 않고 화면에 맡긴다", async () => {
        vi.mocked(refreshTokens).mockRejectedValue(axiosStatusOnly(500));

        const response = await proxy(requestTo("/home", "hk_refresh=refresh-1"));

        expect(response.headers.get("location")).toBeNull();
      });

      it("로그인했으면 로그인 전용 화면에서 홈으로 보낸다", async () => {
        const response = await proxy(requestTo("/login", `hk_access=${VALID_ACCESS}`));

        expect(response.headers.get("location")).toBe("http://localhost:3000/home");
      });

      it("재발급으로 로그인 상태가 되면 로그인 전용 화면에서 홈으로 보낸다", async () => {
        vi.mocked(refreshTokens).mockResolvedValue(REFRESHED);

        const response = await proxy(requestTo("/login", "hk_refresh=refresh-1"));

        expect(response.headers.get("location")).toBe("http://localhost:3000/home");
      });
    });
  });

  describe("화면 정보 전달", () => {
    describe("정상 처리", () => {
      it("지금 화면의 경로와 쿼리를 화면 쪽에 넘긴다", async () => {
        const response = await proxy(
          requestTo("/records?date=2026-11-12&page=1", `hk_access=${VALID_ACCESS}`),
        );

        expect(response.headers.get("x-middleware-request-x-hk-pathname")).toBe(
          "/records?date=2026-11-12&page=1",
        );
      });

      it.each([
        { method: "POST", outside: "0", flag: "1" },
        { method: "GET", outside: "1", flag: "0" },
      ])(
        "요청 방식이 '$method'이면 밖에서 보낸 값과 상관없이 서버 액션 표시를 '$flag'로 넘긴다",
        async ({ method, outside, flag }) => {
          const response = await proxy(
            requestTo("/practice/mode", `hk_access=${VALID_ACCESS}`, {
              method,
              headers: { "x-hk-server-action": outside },
            }),
          );

          expect(response.headers.get("x-middleware-request-x-hk-server-action")).toBe(flag);
        },
      );
    });
  });
});
