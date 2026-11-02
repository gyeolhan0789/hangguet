// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import type { ProblemDetail, SocialLoginResponse } from "@/types/api";

// 카카오 콜백(로그인 1.6 · 알림 켜기 2.9 · 계정 연결 2.12). HTTP 경계(plainClient)만 바꾸고, 요청 쿠키 · 응답(이동 · Set-Cookie)을 그대로 본다.
// 기준: 웹 Swagger 1.6 · 2.9 · 2.12 · 기획 메모 S01-3 · S09-1-B(가입한 회원 → 홈, 처음 온 사람 → S01 약관 동의 모달, 알림 → S09-1,
// 카카오 화면 취소는 문구 없이, 고칠 수 있는 오류는 서버 detail · 고칠 수 없는 오류는 정해 둔 문구) · 사용자 결정(연결하면 S09-1에
// 완료 안내 모달, 2.12 오류는 모두 서버 문구)

const post = vi.fn();
const put = vi.fn();
vi.mock("@/lib/api/token-refresh", () => ({ plainClient: { post, put } }));

const { GET } = await import("./route");
const { NOTICE_COOKIE, OAUTH_STATE_COOKIE, SOCIAL_SIGNUP_COOKIE } =
  await import("@/lib/auth/kakao");
const { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } = await import("@/lib/api/auth-cookies");

const REDIRECT_URI = "http://localhost:3000/oauth/kakao/callback";
const SOCIAL_LOGIN_FAILED = "소셜 로그인에 실패했어요. 다시 시도해 주세요.";
const KAKAO_CONSENT_FAILED = "카카오 동의를 확인하지 못했어요. 다시 시도해 주세요.";
const SOCIAL_LINK_FAILED = "카카오 계정을 확인하지 못했어요. 다시 시도해 주세요.";
const LINKED = { target: "settings", linked: true };

const tokens = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresIn: 3600,
  user: { id: 1, email: "a@kakao.com", nickname: "면접왕", profileImageUrl: null },
};
const loggedIn: SocialLoginResponse = { signupRequired: false, token: tokens, signup: null };
const newcomer: SocialLoginResponse = {
  signupRequired: true,
  token: null,
  signup: { signupToken: "Zm9v", email: "a@kakao.com", nickname: "면접왕", expiresIn: 600 },
};

const problem = (body: Partial<ProblemDetail>) =>
  axiosProblem({ title: "Error", status: 400, detail: "", instance: "/api/v1", code: "", ...body });

/** 콜백 요청. query는 카카오가 붙여 보내는 값, cookies는 브라우저가 실어 보내는 쿠키 */
function callback(query: Record<string, string>, cookies: Record<string, string> = {}) {
  const url = new URL(REDIRECT_URI);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
  return GET(new NextRequest(url, { headers: cookie ? { cookie } : {} }));
}

const notice = (
  response: Response & { cookies: { get(name: string): { value: string } | undefined } },
) => {
  const value = response.cookies.get(NOTICE_COOKIE)?.value;
  return value ? (JSON.parse(value) as unknown) : null;
};

beforeEach(() => {
  post.mockReset();
  put.mockReset();
  vi.stubEnv("KAKAO_CLIENT_ID", "client-id");
  vi.stubEnv("KAKAO_REDIRECT_URI", REDIRECT_URI);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("공통", () => {
  it("응답을 캐시하지 않고 Referer를 보내지 않게 한다", async () => {
    post.mockResolvedValue({ data: loggedIn });

    const response = await callback({ code: "c", state: "s" }, { [OAUTH_STATE_COOKIE]: "login.s" });

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("state가 맞으면 state 쿠키를 지운다(한 번만 쓴다)", async () => {
    post.mockResolvedValue({ data: loggedIn });

    const response = await callback({ code: "c", state: "s" }, { [OAUTH_STATE_COOKIE]: "login.s" });

    expect(response.cookies.get(OAUTH_STATE_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });

  it("로그아웃 상태에서 state가 다르면 API를 부르지 않고 S01에 SOCIAL_LOGIN_FAILED, state 쿠키는 그대로", async () => {
    const response = await callback(
      { code: "c", state: "other" },
      { [OAUTH_STATE_COOKIE]: "login.s" },
    );

    expect(post).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/login");
    expect(notice(response)).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
    expect(response.cookies.get(OAUTH_STATE_COOKIE)).toBeUndefined();
  });

  it("로그인한 회원이 state 쿠키가 만료된 채 돌아오면 S09-1에 KAKAO_CONSENT_FAILED", async () => {
    const response = await callback({ code: "c", state: "s" }, { [ACCESS_TOKEN_COOKIE]: "access" });

    expect(put).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/mypage/settings");
    expect(notice(response)).toEqual({ target: "settings", text: KAKAO_CONSENT_FAILED });
  });

  it("카카오 동의 화면에서 취소하면(access_denied) 문구 없이 돌아간다", async () => {
    const response = await callback(
      { error: "access_denied", state: "s" },
      { [OAUTH_STATE_COOKIE]: "login.s" },
    );

    expect(response.headers.get("location")).toBe("/login");
    expect(notice(response)).toBeNull();
  });

  it.each([
    ["카카오가 다른 오류를 주면", { error: "server_error", state: "s" }],
    ["인가 코드가 없으면", { state: "s" }],
  ])("%s 정해 둔 문구", async (_, query) => {
    const response = await callback(query, { [OAUTH_STATE_COOKIE]: "login.s" });

    expect(post).not.toHaveBeenCalled();
    expect(notice(response)).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
  });

  it("카카오 설정이 없으면 SOCIAL_LOGIN_UNAVAILABLE 문구", async () => {
    vi.stubEnv("KAKAO_CLIENT_ID", "");

    const response = await callback({ code: "c", state: "s" }, { [OAUTH_STATE_COOKIE]: "login.s" });

    expect(post).not.toHaveBeenCalled();
    expect(notice(response)).toEqual({
      target: "login",
      text: "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
  });
});

describe("로그인 (1.6)", () => {
  const login = (cookies: Record<string, string> = {}) =>
    callback({ code: "c", state: "s" }, { [OAUTH_STATE_COOKIE]: "login.s", ...cookies });

  it("다른 탭에서 그 사이 로그인했으면 1.6을 부르지 않고 지금 세션 그대로 홈으로", async () => {
    const response = await login({ [ACCESS_TOKEN_COOKIE]: "current" });

    expect(post).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/home");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(notice(response)).toBeNull();
  });

  it("인가 코드와 콜백 주소를 보내고, 가입한 회원이면 토큰을 저장해 홈으로", async () => {
    post.mockResolvedValue({ data: loggedIn });

    const response = await login({ [SOCIAL_SIGNUP_COOKIE]: "old" });

    expect(post).toHaveBeenCalledWith("/auth/oauth/kakao", {
      code: "c",
      redirectUri: REDIRECT_URI,
    });
    expect(response.headers.get("location")).toBe("/home");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("access");
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("refresh");
    // 닫지 않고 떠난 예전 가입 토큰도 지운다
    expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
    expect(notice(response)).toBeNull();
  });

  it("처음 온 사람이면 가입 토큰을 유효 시간 동안 저장하고 S01(약관 동의 모달)로", async () => {
    post.mockResolvedValue({ data: newcomer });

    const response = await login();

    expect(response.headers.get("location")).toBe("/login");
    expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toMatchObject({
      value: "Zm9v",
      maxAge: 600,
    });
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(notice(response)).toBeNull();
  });

  it("응답에 토큰도 가입 정보도 없으면 SOCIAL_LOGIN_FAILED", async () => {
    post.mockResolvedValue({ data: { signupRequired: true, token: null, signup: null } });

    const response = await login();

    expect(notice(response)).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
  });

  it.each([
    [
      "400 SOCIAL_EMAIL_REQUIRED",
      400,
      "SOCIAL_EMAIL_REQUIRED",
      "이메일 제공에 동의해야 가입할 수 있어요.",
    ],
    [
      "409 SOCIAL_EMAIL_DUPLICATED",
      409,
      "SOCIAL_EMAIL_DUPLICATED",
      "이미 가입한 이메일이에요. 처음 가입한 방법으로 로그인해 주세요.",
    ],
    [
      "503 SOCIAL_LOGIN_UNAVAILABLE",
      503,
      "SOCIAL_LOGIN_UNAVAILABLE",
      "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    ],
  ])("%s면 S01에 서버 문구", async (_, status, code, detail) => {
    post.mockRejectedValue(problem({ status, code, detail }));

    const response = await login();

    expect(response.headers.get("location")).toBe("/login");
    expect(notice(response)).toEqual({ target: "login", text: detail });
  });

  it.each([
    [
      "401 SOCIAL_LOGIN_FAILED",
      problem({ status: 401, code: "SOCIAL_LOGIN_FAILED", detail: "다른 문구" }),
    ],
    [
      "400 VALIDATION_FAILED(등록 안 된 주소)",
      problem({ code: "VALIDATION_FAILED", detail: "입력값을 확인해 주세요." }),
    ],
  ])("%s는 정해 둔 문구(SOCIAL_LOGIN_FAILED)", async (_, error) => {
    post.mockRejectedValue(error);

    const response = await login();

    expect(notice(response)).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
  });

  it("서버에 닿지 못하면 다시 시도 안내", async () => {
    post.mockRejectedValue(axiosNoResponse());

    const response = await login();

    expect(notice(response)).toEqual({ target: "login", text: "잠시 후 다시 시도해 주세요." });
  });
});

describe("연습 알림 켜기 (2.9)", () => {
  const alarm = (cookies: Record<string, string> = { [ACCESS_TOKEN_COOKIE]: "access" }) =>
    callback({ code: "c", state: "s" }, { [OAUTH_STATE_COOKIE]: "alarm.s", ...cookies });

  it("쿠키의 토큰을 붙여 인가 코드를 보내고, 성공하면 문구 없이 S09-1로", async () => {
    put.mockResolvedValue({ data: { available: true, enabled: true, time: "21:00" } });

    const response = await alarm();

    expect(put).toHaveBeenCalledWith(
      "/users/me/practice-alarm",
      { code: "c", redirectUri: REDIRECT_URI },
      { headers: { Authorization: "Bearer access" } },
    );
    expect(post).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/mypage/settings");
    expect(notice(response)).toBeNull();
  });

  it("그 사이 로그아웃해 토큰이 없으면 2.9를 부르지 않고 로그인 화면으로", async () => {
    const response = await alarm({});

    expect(put).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/login");
  });

  it.each([
    [
      "400 KAKAO_ACCOUNT_MISMATCH",
      400,
      "KAKAO_ACCOUNT_MISMATCH",
      "가입할 때 쓴 카카오 계정으로 동의해 주세요.",
    ],
    [
      "400 KAKAO_MESSAGE_CONSENT_REQUIRED",
      400,
      "KAKAO_MESSAGE_CONSENT_REQUIRED",
      "카카오톡 메시지 전송에 동의해야 알림을 받을 수 있어요.",
    ],
    [
      "409 PRACTICE_ALARM_UNAVAILABLE",
      409,
      "PRACTICE_ALARM_UNAVAILABLE",
      "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요.",
    ],
    [
      "503 KAKAO_UNAVAILABLE",
      503,
      "KAKAO_UNAVAILABLE",
      "카카오 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    ],
  ])("%s면 S09-1에 서버 문구", async (_, status, code, detail) => {
    put.mockRejectedValue(problem({ status, code, detail }));

    const response = await alarm();

    expect(response.headers.get("location")).toBe("/mypage/settings");
    expect(notice(response)).toEqual({ target: "settings", text: detail });
  });

  it.each([
    ["400 KAKAO_CONSENT_FAILED", problem({ code: "KAKAO_CONSENT_FAILED", detail: "다른 문구" })],
    [
      "400 VALIDATION_FAILED",
      problem({ code: "VALIDATION_FAILED", detail: "입력값을 확인해 주세요." }),
    ],
  ])("%s는 정해 둔 문구(KAKAO_CONSENT_FAILED)", async (_, error) => {
    put.mockRejectedValue(error);

    const response = await alarm();

    expect(notice(response)).toEqual({ target: "settings", text: KAKAO_CONSENT_FAILED });
  });

  it.each(["TOKEN_EXPIRED", "UNAUTHORIZED"])(
    "401 %s면 인가 코드가 든 주소를 넘기지 않고 문구 없이 S09-1로(그 화면이 재발급 · 로그인 처리)",
    async (code) => {
      put.mockRejectedValue(problem({ status: 401, code }));

      const response = await alarm();

      expect(response.headers.get("location")).toBe("/mypage/settings");
      expect(notice(response)).toBeNull();
    },
  );

  it("카카오 설정이 없으면 KAKAO_UNAVAILABLE 문구", async () => {
    vi.stubEnv("KAKAO_REDIRECT_URI", "");

    const response = await alarm();

    expect(put).not.toHaveBeenCalled();
    expect(notice(response)).toEqual({
      target: "settings",
      text: "카카오 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
  });

  it("알림 동의 화면에서 취소하면 문구 없이 S09-1로, 가입 토큰은 건드리지 않는다", async () => {
    const response = await callback(
      { error: "access_denied", state: "s" },
      { [OAUTH_STATE_COOKIE]: "alarm.s", [ACCESS_TOKEN_COOKIE]: "access" },
    );

    expect(response.headers.get("location")).toBe("/mypage/settings");
    expect(notice(response)).toBeNull();
    expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toBeUndefined();
  });
});

describe("계정 연결 (2.12)", () => {
  const link = (cookies: Record<string, string> = { [ACCESS_TOKEN_COOKIE]: "access" }) =>
    callback({ code: "c", state: "s" }, { [OAUTH_STATE_COOKIE]: "link.s", ...cookies });

  it("쿠키의 토큰을 붙여 인가 코드를 보내고, 성공하면 S09-1로 가며 완료 표시를 남긴다(state는 지운다)", async () => {
    put.mockResolvedValue({ data: {} });

    const response = await link();

    expect(put).toHaveBeenCalledWith(
      "/users/me/social-accounts/kakao",
      { code: "c", redirectUri: REDIRECT_URI },
      { headers: { Authorization: "Bearer access" } },
    );
    expect(post).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/mypage/settings");
    expect(notice(response)).toEqual(LINKED);
    expect(response.cookies.get(OAUTH_STATE_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });

  it("그 사이 로그아웃해 토큰이 없으면 2.12를 부르지 않고 로그인 화면으로", async () => {
    const response = await link({});

    expect(put).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/login");
    expect(notice(response)).toBeNull();
  });

  it.each([
    ["400 SOCIAL_LINK_FAILED", 400, "SOCIAL_LINK_FAILED", "서버가 준 연결 실패 문구"],
    ["409 SOCIAL_ALREADY_LINKED", 409, "SOCIAL_ALREADY_LINKED", "이미 연결한 소셜 계정이 있어요."],
    [
      "409 SOCIAL_ACCOUNT_IN_USE",
      409,
      "SOCIAL_ACCOUNT_IN_USE",
      "다른 회원이 쓰고 있는 카카오 계정이에요.",
    ],
    [
      "503 SOCIAL_LOGIN_UNAVAILABLE",
      503,
      "SOCIAL_LOGIN_UNAVAILABLE",
      "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    ],
  ])("%s면 S09-1에 서버 문구(완료 표시 없음)", async (_, status, code, detail) => {
    put.mockRejectedValue(problem({ status, code, detail }));

    const response = await link();

    expect(response.headers.get("location")).toBe("/mypage/settings");
    expect(notice(response)).toEqual({ target: "settings", text: detail });
  });

  it("그 밖의 오류(400 VALIDATION_FAILED)는 정해 둔 문구(SOCIAL_LINK_FAILED)", async () => {
    put.mockRejectedValue(
      problem({ code: "VALIDATION_FAILED", detail: "입력값을 확인해 주세요." }),
    );

    const response = await link();

    expect(notice(response)).toEqual({ target: "settings", text: SOCIAL_LINK_FAILED });
  });

  it("서버에 닿지 못하면 S09-1에 다시 시도 안내", async () => {
    put.mockRejectedValue(axiosNoResponse());

    const response = await link();

    expect(notice(response)).toEqual({
      target: "settings",
      text: "잠시 후 다시 시도해 주세요.",
    });
  });

  it.each(["TOKEN_EXPIRED", "UNAUTHORIZED"])(
    "401 %s면 인가 코드가 든 주소를 넘기지 않고 문구 없이 S09-1로, 토큰 쿠키는 건드리지 않는다",
    async (code) => {
      put.mockRejectedValue(problem({ status: 401, code }));

      const response = await link();

      expect(response.headers.get("location")).toBe("/mypage/settings");
      expect(notice(response)).toBeNull();
      expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
    },
  );

  it("카카오 동의 화면에서 취소하면 2.12를 부르지 않고 문구 없이 S09-1로", async () => {
    const response = await callback(
      { error: "access_denied", state: "s" },
      { [OAUTH_STATE_COOKIE]: "link.s", [ACCESS_TOKEN_COOKIE]: "access" },
    );

    expect(put).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/mypage/settings");
    expect(notice(response)).toBeNull();
  });

  it.each([
    ["카카오가 다른 오류를 주면", { error: "server_error", state: "s" }],
    ["인가 코드가 없으면", { state: "s" }],
  ])("%s 2.12를 부르지 않고 SOCIAL_LINK_FAILED", async (_, query) => {
    const response = await callback(query, {
      [OAUTH_STATE_COOKIE]: "link.s",
      [ACCESS_TOKEN_COOKIE]: "access",
    });

    expect(put).not.toHaveBeenCalled();
    expect(notice(response)).toEqual({ target: "settings", text: SOCIAL_LINK_FAILED });
  });

  it("카카오 설정이 없으면 SOCIAL_LOGIN_UNAVAILABLE 문구", async () => {
    vi.stubEnv("KAKAO_REDIRECT_URI", "");

    const response = await link();

    expect(put).not.toHaveBeenCalled();
    expect(notice(response)).toEqual({
      target: "settings",
      text: "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
  });

  it("로그인한 회원의 state가 다르면 2.12를 부르지 않고, 쿠키에 남은 용도(연결)대로 S09-1에 SOCIAL_LINK_FAILED, state 쿠키는 그대로", async () => {
    const response = await callback(
      { code: "c", state: "other" },
      { [OAUTH_STATE_COOKIE]: "link.s", [ACCESS_TOKEN_COOKIE]: "access" },
    );

    expect(put).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/mypage/settings");
    expect(notice(response)).toEqual({ target: "settings", text: SOCIAL_LINK_FAILED });
    expect(response.cookies.get(OAUTH_STATE_COOKIE)).toBeUndefined();
  });

  it.each([
    [
      "로그인한 회원 · 쿠키 용도가 로그인",
      { [OAUTH_STATE_COOKIE]: "login.s", [ACCESS_TOKEN_COOKIE]: "access" },
      "/mypage/settings",
      { target: "settings", text: KAKAO_CONSENT_FAILED },
    ],
    [
      "로그아웃 · 쿠키 용도가 연결",
      { [OAUTH_STATE_COOKIE]: "link.s" },
      "/login",
      { target: "login", text: SOCIAL_LOGIN_FAILED },
    ],
  ])("state가 다를 때 %s면 로그인 여부로 화면을 고른다", async (_, cookies, location, text) => {
    const response = await callback({ code: "c", state: "other" }, cookies);

    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(location);
    expect(notice(response)).toEqual(text);
  });
});

describe("분기 보강", () => {
  it.each([
    [
      "로그인한 회원 · 알림 state가 다르다",
      { state: "other" },
      { [OAUTH_STATE_COOKIE]: "alarm.s", [ACCESS_TOKEN_COOKIE]: "access" },
      "/mypage/settings",
      "settings",
      KAKAO_CONSENT_FAILED,
    ],
    [
      "로그인한 회원 · 주소에 state가 없다",
      {},
      { [OAUTH_STATE_COOKIE]: "alarm.s", [ACCESS_TOKEN_COOKIE]: "access" },
      "/mypage/settings",
      "settings",
      KAKAO_CONSENT_FAILED,
    ],
    [
      "로그아웃 상태 · 알림 state가 다르다",
      { state: "other" },
      { [OAUTH_STATE_COOKIE]: "alarm.s" },
      "/login",
      "login",
      SOCIAL_LOGIN_FAILED,
    ],
  ])(
    "%s → API를 부르지 않고 정해 둔 문구, state · 가입 토큰 쿠키는 그대로",
    async (_, query, cookies, location, target, text) => {
      const response = await callback(
        { code: "c", ...query },
        { ...cookies, [SOCIAL_SIGNUP_COOKIE]: "old" },
      );

      expect(post).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(response.headers.get("location")).toBe(location);
      expect(notice(response)).toEqual({ target, text });
      expect(response.cookies.get(OAUTH_STATE_COOKIE)).toBeUndefined();
      expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toBeUndefined();
    },
  );

  it("로그인 취소(access_denied)는 1.6을 부르지 않고 state와 예전 가입 토큰을 지운다", async () => {
    const response = await callback(
      { error: "access_denied", state: "s" },
      { [OAUTH_STATE_COOKIE]: "login.s", [SOCIAL_SIGNUP_COOKIE]: "old" },
    );

    expect(post).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/login");
    expect(notice(response)).toBeNull();
    expect(response.cookies.get(OAUTH_STATE_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
    expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });

  it.each([
    ["카카오가 다른 오류를 주면", { error: "server_error", state: "s" }],
    ["인가 코드가 없으면", { state: "s" }],
  ])("알림 용도에서 %s S09-1에 KAKAO_CONSENT_FAILED", async (_, query) => {
    const response = await callback(query, {
      [OAUTH_STATE_COOKIE]: "alarm.s",
      [ACCESS_TOKEN_COOKIE]: "access",
    });

    expect(put).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/mypage/settings");
    expect(notice(response)).toEqual({ target: "settings", text: KAKAO_CONSENT_FAILED });
  });

  it("이미 로그인한 상태의 로그인 용도는 state와 예전 가입 토큰을 지운다", async () => {
    const response = await callback(
      { code: "c", state: "s" },
      {
        [OAUTH_STATE_COOKIE]: "login.s",
        [ACCESS_TOKEN_COOKIE]: "current",
        [SOCIAL_SIGNUP_COOKIE]: "old",
      },
    );

    expect(post).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/home");
    expect(response.cookies.get(OAUTH_STATE_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
    expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });

  it("1.6이 가입한 회원이라면서 토큰을 주지 않으면 SOCIAL_LOGIN_FAILED, 예전 가입 토큰은 지운다", async () => {
    post.mockResolvedValue({ data: { signupRequired: false, token: null, signup: null } });

    const response = await callback(
      { code: "c", state: "s" },
      { [OAUTH_STATE_COOKIE]: "login.s", [SOCIAL_SIGNUP_COOKIE]: "old" },
    );

    expect(notice(response)).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
    expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
  });

  it("서버 문구는 서버가 준 그대로 넘긴다(정해 둔 문구와 다른 detail)", async () => {
    post.mockRejectedValue(
      problem({ status: 503, code: "SOCIAL_LOGIN_UNAVAILABLE", detail: "카카오 점검 중이에요." }),
    );

    const response = await callback({ code: "c", state: "s" }, { [OAUTH_STATE_COOKIE]: "login.s" });

    expect(notice(response)).toEqual({ target: "login", text: "카카오 점검 중이에요." });
  });

  it.each([
    ["로그인 1.6", "login.s", {}, SOCIAL_LOGIN_FAILED, "login", "SOCIAL_EMAIL_DUPLICATED"],
    [
      "알림 2.9",
      "alarm.s",
      { [ACCESS_TOKEN_COOKIE]: "access" },
      KAKAO_CONSENT_FAILED,
      "settings",
      "KAKAO_ACCOUNT_MISMATCH",
    ],
  ])(
    "%s: 보여 줄 코드여도 서버 문구가 비어 있으면 정해 둔 문구",
    async (_, state, cookies, text, target, code) => {
      const error = problem({ status: 409, code, detail: "" });
      post.mockRejectedValue(error);
      put.mockRejectedValue(error);

      const response = await callback(
        { code: "c", state: "s" },
        { [OAUTH_STATE_COOKIE]: state, ...cookies },
      );

      expect(notice(response)).toEqual({ target, text });
    },
  );

  it("2.9에서 서버에 닿지 못하면 S09-1에 다시 시도 안내", async () => {
    put.mockRejectedValue(axiosNoResponse());

    const response = await callback(
      { code: "c", state: "s" },
      { [OAUTH_STATE_COOKIE]: "alarm.s", [ACCESS_TOKEN_COOKIE]: "access" },
    );

    expect(notice(response)).toEqual({ target: "settings", text: "잠시 후 다시 시도해 주세요." });
  });

  it("2.9 401이면 로그인 토큰 쿠키는 건드리지 않는다(재발급 · 로그아웃은 설정 화면에서)", async () => {
    put.mockRejectedValue(problem({ status: 401, code: "UNAUTHORIZED" }));

    const response = await callback(
      { code: "c", state: "s" },
      { [OAUTH_STATE_COOKIE]: "alarm.s", [ACCESS_TOKEN_COOKIE]: "access" },
    );

    expect(response.headers.get("location")).toBe("/mypage/settings");
    expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
    expect(response.cookies.get(REFRESH_TOKEN_COOKIE)).toBeUndefined();
  });

  it("문구는 Set-Cookie에 인코딩된 JSON으로 실린다(주소에는 싣지 않는다)", async () => {
    post.mockRejectedValue(axiosNoResponse());

    const response = await callback({ code: "c", state: "s" }, { [OAUTH_STATE_COOKIE]: "login.s" });

    const header = response.headers
      .getSetCookie()
      .find((line) => line.startsWith(`${NOTICE_COOKIE}=`));
    const value = decodeURIComponent(header!.slice(NOTICE_COOKIE.length + 1).split(";")[0]);
    expect(JSON.parse(value)).toEqual({ target: "login", text: "잠시 후 다시 시도해 주세요." });
    expect(header).toContain("HttpOnly");
    expect(response.headers.get("location")).toBe("/login");
  });
});
