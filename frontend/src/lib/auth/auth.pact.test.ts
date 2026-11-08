import { MatchersV3 } from "@pact-foundation/pact";
import { describe, expect, it } from "vitest";

import { refreshTokens } from "@/lib/api/token-refresh";
import {
  asGuest,
  asMember,
  bearer,
  contract,
  cookieValues,
  EXAMPLE_ACCESS_TOKEN,
  EXAMPLE_REFRESH_TOKEN,
  problem,
  providerValue,
  shape,
} from "@/test/pact";
import type { MeResponse, RefreshResponse } from "@/types/api";

import {
  checkEmailAvailable,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  signup,
} from "./actions";
import { NOTICE_COOKIE, SOCIAL_SIGNUP_COOKIE } from "./kakao";
import { getMe } from "./session";
import { socialSignup } from "./social-actions";

// 기준: Swagger 1.1 이메일 사용 가능 여부 · 1.2 회원가입 · 1.3 로그인(429 LOGIN_LOCKED 포함) · 1.4 토큰 재발급 · 1.5 로그아웃
// · 1.7 소셜 회원가입 · 1.8 비밀번호 찾기 메일 요청 · 1.9 비밀번호 재설정
// · 2.1 내 정보 · 공통 401(TOKEN_EXPIRED · UNAUTHORIZED) 예시
// 1.6 소셜 로그인과 1.7 성공은 BE 계약 테스트에 카카오 클라이언트(@MockitoBean)와 가입 토큰 · 카카오 회원 상황(@State)이 있어야
// 재현된다. 아직 BE에 없어 이번에는 상황 없이 재현되는 1.7 무효 가입 토큰만 넣었다. BE 상황이 생기면 1.6(가입한 회원 · 처음 온
// 사람)과 1.7 성공을 더한다.
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
  // S09-1 카카오 줄 · 비밀번호 변경 · 탈퇴 모달이 이 값으로 나뉜다(이메일 회원은 null)
  socialProvider: null,
  // S09-1 카카오 줄(연결하기 · 연결됨 + 연결 해제)이 이 값으로 나뉜다(연결하지 않았으면 null)
  linkedProvider: null,
} satisfies MeResponse;
const signupValues = {
  nickname: "면접왕",
  email: "a@ssafy.com",
  password: "abcd1234",
  passwordConfirm: "abcd1234",
  agreements: { AGE: true, TERMS: true, PRIVACY: true, RECORDING: true },
} as const;
const signupBody = {
  nickname: "면접왕",
  email,
  password: "abcd1234",
  agreements: [
    { termsType: "TERMS", termsVersion: "1.0" },
    { termsType: "PRIVACY", termsVersion: "1.0" },
    { termsType: "RECORDING", termsVersion: "1.1" },
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

  it("1.7 가입 토큰이 무효면 S01로 돌아간다(401 SIGNUP_TOKEN_INVALID)", () =>
    pact
      .addInteraction()
      .uponReceiving("1.7 무효인 가입 토큰으로 소셜 회원가입")
      .withRequest("POST", "/api/v1/auth/oauth/signup", (b) =>
        b.jsonBody({
          signupToken: "Zm9v…",
          agreements: signupBody.agreements,
        }),
      )
      .willRespondWith(401, (b) =>
        problem(b, {
          detail: "가입 시간이 지났어요. 다시 로그인해 주세요.",
          code: "SIGNUP_TOKEN_INVALID",
        }),
      )
      .executeTest(
        asGuest(async () => {
          cookieValues[SOCIAL_SIGNUP_COOKIE] = "Zm9v…";
          await expect(
            socialSignup({ AGE: true, TERMS: true, PRIVACY: true, RECORDING: true }),
          ).rejects.toThrow("REDIRECT /login");
          // FE가 서버 문구(detail)를 읽어 S01에 보이도록 남긴다
          expect(JSON.parse(cookieValues[NOTICE_COOKIE])).toEqual({
            target: "login",
            text: "가입 시간이 지났어요. 다시 로그인해 주세요.",
          });
        }),
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

  it("1.3 잠긴 이메일이면 남은 시간을 분으로 안내한다(429 LOGIN_LOCKED)", () =>
    pact
      .addInteraction()
      .given("로그인이 잠긴 회원")
      .uponReceiving("1.3 잠긴 이메일로 로그인")
      .withRequest("POST", "/api/v1/auth/login", (b) => b.jsonBody({ email, password: "abcd1234" }))
      .willRespondWith(429, (b) =>
        // retryAfterSeconds가 있으면 FE는 detail 대신 남은 분을 넣은 문구를 쓴다(detail을 읽지 않는다)
        problem(b, { code: "LOGIN_LOCKED", retryAfterSeconds: 900 }),
      )
      .executeTest(
        asGuest(async () =>
          expect(await login({ email: "a@ssafy.com", password: "abcd1234" })).toEqual({
            formError: "로그인에 여러 번 실패했어요. 15분 뒤에 다시 시도해 주세요.",
          }),
        ),
      ));

  it("1.8 비밀번호 찾기 메일을 요청한다", () =>
    pact
      .addInteraction()
      .given("회원")
      .uponReceiving("1.8 비밀번호 찾기 메일 요청")
      .withRequest("POST", "/api/v1/auth/password-reset", (b) => b.jsonBody({ email }))
      .willRespondWith(204)
      .executeTest(
        asGuest(async () =>
          expect(await requestPasswordReset({ email: "a@ssafy.com" })).toEqual({ ok: true }),
        ),
      ));

  it("1.9 메일 링크의 token으로 비밀번호를 바꾼다", () =>
    pact
      .addInteraction()
      .given("비밀번호 재설정 링크")
      .uponReceiving("1.9 비밀번호 재설정")
      .withRequest("POST", "/api/v1/auth/password-reset/confirm", (b) =>
        b.jsonBody({
          token: providerValue("resetToken", "i1BUXG8z_ulEvbGIqGuA3g9us0MGdYX9Ct_gcpJSAyo"),
          newPassword: "efgh5678",
        }),
      )
      .willRespondWith(204)
      .executeTest(
        asGuest(async () =>
          expect(
            await resetPassword("i1BUXG8z_ulEvbGIqGuA3g9us0MGdYX9Ct_gcpJSAyo", {
              password: "efgh5678",
              passwordConfirm: "efgh5678",
            }),
          ).toEqual({ ok: true }),
        ),
      ));

  it("1.9 만료된 링크면 다시 받게 안내한다(400 PASSWORD_RESET_TOKEN_INVALID)", () =>
    pact
      .addInteraction()
      .uponReceiving("1.9 만료된 링크로 비밀번호 재설정")
      .withRequest("POST", "/api/v1/auth/password-reset/confirm", (b) =>
        b.jsonBody({ token: "expired-link", newPassword: "efgh5678" }),
      )
      .willRespondWith(400, (b) =>
        problem(b, {
          detail: "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.",
          code: "PASSWORD_RESET_TOKEN_INVALID",
        }),
      )
      .executeTest(
        asGuest(async () =>
          expect(
            await resetPassword("expired-link", {
              password: "efgh5678",
              passwordConfirm: "efgh5678",
            }),
          ).toEqual({
            linkInvalid: true,
            formError: "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.",
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
      .willRespondWith(200, (b) =>
        b.jsonBody(
          shape(me, "profileImageUrl", "currentStreak", "socialProvider", "linkedProvider"),
        ),
      )
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
