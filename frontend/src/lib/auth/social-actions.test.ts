// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import { redirectTo } from "@/test/redirect";
import type { ProblemDetail } from "@/types/api";

// 카카오 로그인 시작 · 1.7 소셜 회원가입 서버 액션. HTTP 경계(plainClient)와 Next 서버 함수(cookies · redirect)만 바꾼다.
// 기준: 웹 Swagger 1.7(signupToken · agreements 3개 → 201 TokenResponse · 401 SIGNUP_TOKEN_INVALID · 409 SOCIAL_EMAIL_DUPLICATED
// · 400 AGREEMENT_REQUIRED) · 기획 메모 S01-3(고칠 수 있는 오류는 서버 detail, 고칠 수 없는 오류는 SOCIAL_LOGIN_FAILED 문구)

const post = vi.fn();
vi.mock("@/lib/api/token-refresh", () => ({ plainClient: { post } }));

const jar = new Map<string, string>();
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
  has: (name: string) => jar.has(name),
  set: vi.fn((name: string, value: string, options?: { maxAge?: number }) => {
    if (options?.maxAge === 0) jar.delete(name);
    else jar.set(name, value);
  }),
};
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const { cancelSocialSignup, dismissNotice, socialSignup, startKakaoLogin } =
  await import("./social-actions");
const { NOTICE_COOKIE, OAUTH_STATE_COOKIE, SOCIAL_SIGNUP_COOKIE } = await import("./kakao");
const { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } = await import("@/lib/api/auth-cookies");

const agreed = { AGE: true, TERMS: true, PRIVACY: true, RECORDING: true };
const tokens = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresIn: 3600,
  user: { id: 1, email: "a@kakao.com", nickname: "면접왕", profileImageUrl: null },
};
const notice = () => JSON.parse(jar.get(NOTICE_COOKIE) ?? "null") as unknown;
const problem = (body: Partial<ProblemDetail>) =>
  axiosProblem({
    title: "Error",
    status: 400,
    detail: "",
    instance: "/api/v1/auth/oauth/signup",
    code: "",
    ...body,
  });

beforeEach(() => {
  jar.clear();
  post.mockReset();
  redirect.mockClear();
  cookieStore.set.mockClear();
  vi.stubEnv("KAKAO_CLIENT_ID", "client-id");
  vi.stubEnv("KAKAO_REDIRECT_URI", "http://localhost:3000/oauth/kakao/callback");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("startKakaoLogin", () => {
  it("state를 쿠키에 담고 카카오 인가 화면으로 보낸다", async () => {
    await expect(startKakaoLogin()).rejects.toThrow(/^REDIRECT https:\/\/kauth\.kakao\.com\//);

    const url = new URL(redirect.mock.calls[0][0]);
    const state = url.searchParams.get("state");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/oauth/kakao/callback");
    expect(url.searchParams.has("scope")).toBe(false);
    expect(jar.get(OAUTH_STATE_COOKIE)).toBe(`login.${state}`);
  });

  it("닫지 않고 떠난 예전 가입 토큰을 지운다", async () => {
    jar.set(SOCIAL_SIGNUP_COOKIE, "old");

    await expect(startKakaoLogin()).rejects.toThrow(/^REDIRECT /);

    expect(jar.has(SOCIAL_SIGNUP_COOKIE)).toBe(false);
  });

  it("카카오 설정이 없으면 S01로 돌아가 SOCIAL_LOGIN_UNAVAILABLE 문구를 남긴다", async () => {
    vi.stubEnv("KAKAO_CLIENT_ID", "");
    jar.set(SOCIAL_SIGNUP_COOKIE, "old");

    await expect(startKakaoLogin()).rejects.toThrow(redirectTo("/login"));

    expect(notice()).toEqual({
      target: "login",
      text: "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
    });
    expect(jar.has(OAUTH_STATE_COOKIE)).toBe(false);
    expect(jar.has(SOCIAL_SIGNUP_COOKIE)).toBe(false);
  });
});

describe("socialSignup (1.7)", () => {
  beforeEach(() => {
    jar.set(SOCIAL_SIGNUP_COOKIE, "Zm9v");
  });

  it("가입 토큰과 약관 3개로 가입하고, 토큰을 저장해 홈으로 보낸다", async () => {
    post.mockResolvedValue({ data: tokens });

    await expect(socialSignup(agreed)).rejects.toThrow(redirectTo("/home"));

    expect(post).toHaveBeenCalledWith("/auth/oauth/signup", {
      signupToken: "Zm9v",
      agreements: [
        { termsType: "TERMS", termsVersion: "1.0" },
        { termsType: "PRIVACY", termsVersion: "1.0" },
        { termsType: "RECORDING", termsVersion: "1.0" },
      ],
    });
    expect(jar.get(ACCESS_TOKEN_COOKIE)).toBe("access");
    expect(jar.get(REFRESH_TOKEN_COOKIE)).toBe("refresh");
    expect(jar.has(SOCIAL_SIGNUP_COOKIE)).toBe(false);
    expect(jar.has(NOTICE_COOKIE)).toBe(false);
  });

  it.each([
    [
      "401 SIGNUP_TOKEN_INVALID",
      401,
      "SIGNUP_TOKEN_INVALID",
      "가입 시간이 지났어요. 다시 로그인해 주세요.",
    ],
    [
      "409 SOCIAL_EMAIL_DUPLICATED",
      409,
      "SOCIAL_EMAIL_DUPLICATED",
      "이미 가입한 이메일이에요. 처음 가입한 방법으로 로그인해 주세요.",
    ],
  ])("%s면 가입 토큰을 지우고 S01에 서버 문구를 남긴다", async (_, status, code, detail) => {
    post.mockRejectedValue(problem({ status, code, detail }));

    await expect(socialSignup(agreed)).rejects.toThrow(redirectTo("/login"));

    expect(notice()).toEqual({ target: "login", text: detail });
    expect(jar.has(SOCIAL_SIGNUP_COOKIE)).toBe(false);
    expect(jar.has(ACCESS_TOKEN_COOKIE)).toBe(false);
  });

  it.each([
    [
      "400 AGREEMENT_REQUIRED",
      problem({ code: "AGREEMENT_REQUIRED", detail: "필수 약관에 모두 동의해 주세요." }),
    ],
    ["500 INTERNAL_ERROR", problem({ status: 500, code: "INTERNAL_ERROR", detail: "서버 오류" })],
  ])("사용자가 고칠 수 없는 오류(%s)는 SOCIAL_LOGIN_FAILED 문구", async (_, error) => {
    post.mockRejectedValue(error);

    await expect(socialSignup(agreed)).rejects.toThrow(redirectTo("/login"));

    expect(notice()).toEqual({
      target: "login",
      text: "소셜 로그인에 실패했어요. 다시 시도해 주세요.",
    });
  });

  it("보여 줄 코드여도 서버 문구가 비어 있으면 정해 둔 문구(SOCIAL_LOGIN_FAILED)", async () => {
    post.mockRejectedValue(problem({ status: 401, code: "SIGNUP_TOKEN_INVALID", detail: "" }));

    await expect(socialSignup(agreed)).rejects.toThrow(redirectTo("/login"));

    expect(notice()).toEqual({
      target: "login",
      text: "소셜 로그인에 실패했어요. 다시 시도해 주세요.",
    });
  });

  it("서버에 닿지 못하면 다시 시도 안내", async () => {
    post.mockRejectedValue(axiosNoResponse());

    await expect(socialSignup(agreed)).rejects.toThrow(redirectTo("/login"));

    expect(notice()).toEqual({ target: "login", text: "잠시 후 다시 시도해 주세요." });
  });

  it("가입 토큰 쿠키가 만료돼 없으면 1.7을 부르지 않고 1.7 401과 같은 문구", async () => {
    jar.delete(SOCIAL_SIGNUP_COOKIE);

    await expect(socialSignup(agreed)).rejects.toThrow(redirectTo("/login"));

    expect(post).not.toHaveBeenCalled();
    expect(notice()).toEqual({
      target: "login",
      text: "가입 시간이 지났어요. 다시 로그인해 주세요.",
    });
  });

  it("동의가 빠졌으면(화면을 거치지 않은 요청) 1.7을 부르지 않는다", async () => {
    await expect(socialSignup({ ...agreed, AGE: false })).rejects.toThrow(redirectTo("/login"));

    expect(post).not.toHaveBeenCalled();
    expect(notice()).toEqual({
      target: "login",
      text: "소셜 로그인에 실패했어요. 다시 시도해 주세요.",
    });
    expect(jar.has(SOCIAL_SIGNUP_COOKIE)).toBe(false);
  });
});

describe("cancelSocialSignup · dismissNotice", () => {
  it("✕로 닫으면 가입 토큰을 지운다", async () => {
    jar.set(SOCIAL_SIGNUP_COOKIE, "Zm9v");

    await cancelSocialSignup();

    expect(jar.has(SOCIAL_SIGNUP_COOKIE)).toBe(false);
  });

  it("보여 준 문구를 지운다", async () => {
    jar.set(NOTICE_COOKIE, JSON.stringify({ target: "login", text: "x" }));

    await dismissNotice();

    expect(jar.has(NOTICE_COOKIE)).toBe(false);
  });
});
