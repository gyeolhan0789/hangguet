import { describe, expect, it } from "vitest";

import { isAccessTokenExpired } from "./token-refresh";

/** exp(초)만 담은 JWT 모양 문자열. 서명은 검사하지 않으므로 아무 값이나 둔다. */
const jwt = (exp: number) =>
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ sub: "1", exp })).replace(/=+$/, "")}.sig`;

const NOW = Date.UTC(2026, 9, 19, 0, 0, 0);
const nowSeconds = NOW / 1000;

// 액세스 토큰은 JWT다(웹 Swagger 2.2 '토큰의 nickname'). 만료는 exp로 판단한다.
describe("isAccessTokenExpired", () => {
  it("exp가 지났으면 만료", () => {
    expect(isAccessTokenExpired(jwt(nowSeconds - 1), NOW)).toBe(true);
  });

  it("30초 안에 끝나면 미리 만료로 본다", () => {
    expect(isAccessTokenExpired(jwt(nowSeconds + 20), NOW)).toBe(true);
  });

  it("넉넉히 남았으면 만료가 아니다", () => {
    expect(isAccessTokenExpired(jwt(nowSeconds + 3600), NOW)).toBe(false);
  });

  it("한글 닉네임이 든 실제 mock 토큰 모양도 읽는다", () => {
    const payload = Buffer.from(
      JSON.stringify({ sub: "1", nickname: "면접왕", iat: nowSeconds, exp: nowSeconds + 3600 }),
    ).toString("base64url");
    const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${payload}.sig`;

    expect(isAccessTokenExpired(token, NOW)).toBe(false);
    expect(isAccessTokenExpired(token, NOW + 3_600_000)).toBe(true);
  });

  it("JWT 모양이 아니거나 exp가 없으면 판단하지 않는다", () => {
    expect(isAccessTokenExpired("not-a-jwt", NOW)).toBe(false);
    expect(isAccessTokenExpired("eyJhbGciOiJIUzI1NiJ9.e2e-access", NOW)).toBe(false);
    expect(isAccessTokenExpired(`a.${btoa(JSON.stringify({ sub: "1" }))}.b`, NOW)).toBe(false);
  });
});
