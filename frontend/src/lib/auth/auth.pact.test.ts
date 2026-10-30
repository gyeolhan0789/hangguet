import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import { refreshTokens } from "@/lib/api/token-refresh";
import {
  asGuest,
  asMember,
  bearer,
  contract,
  EXAMPLE_ACCESS_TOKEN,
  EXAMPLE_REFRESH_TOKEN,
  problem,
  providerValue,
  shape,
} from "@/test/pact";
import type { MeResponse, RefreshResponse } from "@/types/api";

import { checkEmailAvailable, login, logout, signup } from "./actions";
import { getMe } from "./session";

// 기준: Swagger 1.1 이메일 사용 가능 여부 · 1.2 회원가입 · 1.3 로그인 · 1.4 토큰 재발급 · 1.5 로그아웃 · 2.1 내 정보 ·
// 공통 401(TOKEN_EXPIRED · UNAUTHORIZED) 예시
const { like } = MatchersV3;
const pact = contract();

const email = providerValue("email", "a@ssafy.com");
const refreshToken = providerValue("refreshToken", EXAMPLE_REFRESH_TOKEN);
// 가입 · 로그인 · 재발급 응답에서 FE는 토큰 세 값만 쿠키에 담는다(setAuthCookies)
const tokens = {
  accessToken: "eyJ…",
  refreshToken: EXAMPLE_REFRESH_TOKEN,
  expiresIn: 3600,
} satisfies RefreshResponse;
const me = {
  id: 7,
  email: "a@ssafy.com",
  nickname: "면접왕",
  profileImageUrl: null,
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 0,
} satisfies Omit<MeResponse, "socialProvider">;
const signupValues = {
  nickname: "면접왕",
  email: "a@ssafy.com",
  password: "abcd1234",
  passwordConfirm: "abcd1234",
  agreements: { TERMS: true, PRIVACY: true, RECORDING: true },
} as const;
const signupBody = {
  nickname: "면접왕",
  email,
  password: "abcd1234",
  agreements: [
    { termsType: "TERMS", termsVersion: "1.0" },
    { termsType: "PRIVACY", termsVersion: "1.0" },
    { termsType: "RECORDING", termsVersion: "1.0" },
  ],
};

describe("인증", () => {
  it("1.1 가입하지 않은 이메일이면 true", () =>
    pact
      .addInteraction()
      .given("가입하지 않은 이메일")
      .uponReceiving("1.1 이메일 사용 가능 여부")
      .withRequest("GET", "/api/v1/auth/email-availability", (b) => b.query({ email }))
      .willRespondWith(200, (b) => b.jsonBody({ available: true }))
      .executeTest(
        asGuest(async () => expect(await checkEmailAvailable("a@ssafy.com")).toBe(true)),
      ));

  it("1.2 회원가입하면 로그인 상태가 된다", () =>
    pact
      .addInteraction()
      .given("가입하지 않은 이메일")
      .uponReceiving("1.2 회원가입")
      .withRequest("POST", "/api/v1/auth/signup", (b) => b.jsonBody(signupBody))
      .willRespondWith(201, (b) => b.jsonBody(like(tokens)))
      .executeTest(asGuest(async () => expect(await signup(signupValues)).toEqual({ ok: true }))));

  it("1.2 이미 쓰는 이메일이면 이메일 칸 오류(409 EMAIL_DUPLICATED)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("1.2 이미 쓰는 이메일로 회원가입")
      .withRequest("POST", "/api/v1/auth/signup", (b) => b.jsonBody(signupBody))
      .willRespondWith(409, (b) =>
        problem(b, {
          detail: "이미 사용 중인 이메일이에요.",
          code: "EMAIL_DUPLICATED",
        }),
      )
      .executeTest(
        asGuest(async () =>
          expect(await signup(signupValues)).toEqual({
            fieldErrors: { email: "이미 사용 중인 이메일이에요." },
          }),
        ),
      ));

  it("1.3 로그인하면 홈으로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("1.3 로그인")
      .withRequest("POST", "/api/v1/auth/login", (b) => b.jsonBody({ email, password: "abcd1234" }))
      .willRespondWith(200, (b) => b.jsonBody(like(tokens)))
      .executeTest(
        asGuest(() =>
          expect(login({ email: "a@ssafy.com", password: "abcd1234" })).rejects.toThrow(
            /^REDIRECT /,
          ),
        ),
      ));

  it("1.3 비밀번호가 틀리면 서버 문구(401 LOGIN_FAILED)", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("1.3 틀린 비밀번호로 로그인")
      .withRequest("POST", "/api/v1/auth/login", (b) =>
        b.jsonBody({ email, password: "wrong1234" }),
      )
      .willRespondWith(401, (b) =>
        problem(
          b,
          {
            detail: "이메일 또는 비밀번호를 확인해 주세요.",
            code: "LOGIN_FAILED",
          },
          { generic: true },
        ),
      )
      .executeTest(
        asGuest(async () =>
          expect(await login({ email: "a@ssafy.com", password: "wrong1234" })).toEqual({
            formError: "이메일 또는 비밀번호를 확인해 주세요.",
          }),
        ),
      ));

  it("1.4 리프레시 토큰으로 새 토큰을 받는다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("1.4 토큰 재발급")
      .withRequest("POST", "/api/v1/auth/token/refresh", (b) => b.jsonBody({ refreshToken }))
      .willRespondWith(200, (b) => b.jsonBody(like(tokens)))
      .executeTest(
        asGuest(async () =>
          expect(await refreshTokens(EXAMPLE_REFRESH_TOKEN)).toMatchObject({
            expiresIn: 3600,
          }),
        ),
      ));

  it("1.4 무효인 리프레시 토큰이면 null(401 REFRESH_TOKEN_INVALID)", () =>
    pact
      .addInteraction()
      .uponReceiving("1.4 무효인 토큰으로 재발급")
      .withRequest("POST", "/api/v1/auth/token/refresh", (b) =>
        b.jsonBody({ refreshToken: "00000000-0000-4000-8000-000000000000" }),
      )
      .willRespondWith(401, (b) => problem(b, { code: "REFRESH_TOKEN_INVALID" }))
      .executeTest(
        asGuest(async () =>
          expect(await refreshTokens("00000000-0000-4000-8000-000000000000")).toBeNull(),
        ),
      ));

  it("1.5 로그아웃하면 랜딩으로 간다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("1.5 로그아웃")
      .withRequest("POST", "/api/v1/auth/logout", (b) =>
        b.headers(bearer).jsonBody({ refreshToken }),
      )
      .willRespondWith(204)
      .executeTest(asMember(() => expect(logout()).rejects.toThrow(/^REDIRECT /))));

  it("2.1 내 정보를 받는다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("2.1 내 정보")
      .withRequest("GET", "/api/v1/users/me", (b) => b.headers(bearer))
      .willRespondWith(200, (b) => b.jsonBody(shape(me, "profileImageUrl", "currentStreak")))
      .executeTest(asMember(async () => expect(await getMe()).toEqual(me))));

  it("2.1 만료된 토큰이면 재발급으로 보낸다(401 TOKEN_EXPIRED)", () =>
    pact
      .addInteraction()
      .given("만료된 토큰")
      .uponReceiving("2.1 만료된 토큰으로 내 정보")
      .withRequest("GET", "/api/v1/users/me", (b) => b.headers(bearer))
      .willRespondWith(401, (b) => problem(b, { code: "TOKEN_EXPIRED" }))
      .executeTest(asMember(() => expect(getMe()).rejects.toThrow("REDIRECT /api/auth/refresh"))));

  it("2.1 무효인 토큰이면 로그인 전 상태로 보낸다(401 UNAUTHORIZED)", () =>
    pact
      .addInteraction()
      .uponReceiving("2.1 무효인 토큰으로 내 정보")
      .withRequest("GET", "/api/v1/users/me", (b) =>
        b.headers({ Authorization: `Bearer ${EXAMPLE_ACCESS_TOKEN}` }),
      )
      .willRespondWith(401, (b) => problem(b, { code: "UNAUTHORIZED" }))
      .executeTest(
        asMember(() => expect(getMe()).rejects.toThrow("REDIRECT /api/auth/signed-out")),
      ));
});
