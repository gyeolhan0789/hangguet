// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET } from "./route";

// 기준: src/lib/auth/auth-errors.ts(401 UNAUTHORIZED → 쿠키를 지우고 next로) · 웹 Swagger 공통 401
// standalone 컨테이너에서는 request.url이 https://0.0.0.0:3000이라, 그 주소로 절대 리다이렉트하면 브라우저가 못 간다.
const CONTAINER = "https://0.0.0.0:3000";

function request(next: string) {
  return new NextRequest(`${CONTAINER}/api/auth/signed-out?next=${encodeURIComponent(next)}`, {
    headers: { cookie: "hk_access=a; hk_refresh=r" },
  });
}

describe("GET /api/auth/signed-out", () => {
  it("요청 주소가 컨테이너 주소여도 Location은 경로만 나간다(로그인이 필요한 화면 → 로그인)", () => {
    const response = GET(request("/home"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/login");
  });

  it("로그인 없이 보는 화면이면 그 경로로 보낸다", () => {
    const response = GET(request("/"));

    expect(response.headers.get("location")).toBe("/");
  });

  it("다른 사이트로 가는 next는 받지 않고 로그인으로 보낸다", () => {
    expect(GET(request("//evil.example")).headers.get("location")).toBe("/login");
    expect(GET(request("/\t/evil.example")).headers.get("location")).toBe("/login");
  });

  it("토큰 쿠키 두 개를 지운다(값을 비우고 만료일을 지난 날로)", () => {
    const response = GET(request("/home"));

    for (const name of ["hk_access", "hk_refresh"]) {
      expect(response.cookies.get(name)?.value).toBe("");
      expect(response.cookies.get(name)?.expires).toEqual(new Date(0));
    }
  });
});
