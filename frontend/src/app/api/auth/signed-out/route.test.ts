// @vitest-environment node
// 기준: src/lib/auth/auth-errors.ts(401 UNAUTHORIZED면 쿠키를 지우고 next로) · 웹 Swagger 공통 401
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/api/auth-cookies";

import { GET } from "./route";

// standalone 컨테이너에서는 request.url이 이 주소다
const CONTAINER = "https://0.0.0.0:3000";

function request(next: string) {
  return new NextRequest(`${CONTAINER}/api/auth/signed-out?next=${encodeURIComponent(next)}`, {
    headers: { cookie: `${ACCESS_TOKEN_COOKIE}=a; ${REFRESH_TOKEN_COOKIE}=r` },
  });
}

describe("GET · 로그인 풀림 Route Handler", () => {
  describe("정상 처리", () => {
    it("토큰 쿠키 두 개를 지운다", () => {
      const response = GET(request("/home"));

      expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("");
      expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("");
    });

    it("로그인 없이 보는 화면이면 그 화면으로 보낸다", () => {
      const response = GET(request("/"));

      expect(response.headers.get("location")).toBe("/");
    });
  });
});
