// @vitest-environment node
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { redirectTo } from "@/test/redirect";

const post = vi.fn();
const get = vi.fn();
// 인증 API(1.1~1.5)는 토큰 · 인터셉터 없는 인스턴스로 보낸다. 로그아웃이 만료면 1.4로 재발급한다.
const refreshTokens = vi.fn();
vi.mock("@/lib/api/token-refresh", () => ({ plainClient: { post, get }, refreshTokens }));

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const { checkEmailAvailable, login, logout, requestPasswordReset, resetPassword, signup } =
  await import("./actions");

const tokens = {
  accessToken: "access",
  refreshToken: "refresh",
  expiresIn: 3600,
  user: { id: 1, email: "a@ssafy.com", nickname: "면접왕", profileImageUrl: null },
};

function problem(status: number, body: object) {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { status, data: { status, ...body }, headers: {}, config } as AxiosResponse;
  return new AxiosError("fail", undefined, config, null, response);
}

const signupValues = {
  nickname: "면접왕",
  email: "a@ssafy.com",
  password: "abcd1234",
  passwordConfirm: "abcd1234",
  agreements: { AGE: true, TERMS: true, PRIVACY: true, RECORDING: true },
};

// 테스트마다 응답 · 쿠키 구현과 남은 once 값까지 비운다(clearAllMocks는 호출 기록만 지운다).
beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of [
    post,
    get,
    refreshTokens,
    cookieStore.get,
    cookieStore.set,
    cookieStore.delete,
  ]) {
    mock.mockReset();
  }
});

describe("login", () => {
  it("성공하면 토큰을 쿠키에 저장하고 홈으로 보낸다", async () => {
    post.mockResolvedValue({ data: tokens });

    await expect(login({ email: "a@ssafy.com", password: "abcd1234" })).rejects.toThrow(
      redirectTo("/home"),
    );

    expect(post).toHaveBeenCalledWith("/auth/login", {
      email: "a@ssafy.com",
      password: "abcd1234",
    });
    expect(cookieStore.set).toHaveBeenCalledWith("hk_access", "access", expect.any(Object));
    expect(cookieStore.set).toHaveBeenCalledWith("hk_refresh", "refresh", expect.any(Object));
  });

  it("LOGIN_FAILED면 서버 문구를 폼 오류로 돌려준다", async () => {
    post.mockRejectedValue(
      problem(401, { code: "LOGIN_FAILED", detail: "이메일 또는 비밀번호를 확인해 주세요." }),
    );

    const result = await login({ email: "a@ssafy.com", password: "wrong123" });

    expect(result).toEqual({ formError: "이메일 또는 비밀번호를 확인해 주세요." });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    post.mockRejectedValue(new Error("network"));

    expect(await login({ email: "a@ssafy.com", password: "abcd1234" })).toEqual({
      formError: "잠시 후 다시 시도해 주세요.",
    });
  });
});

describe("login · 429 LOGIN_LOCKED", () => {
  it("남은 시간(retryAfterSeconds)을 분으로 올려 안내한다", async () => {
    post.mockRejectedValue(
      problem(429, {
        code: "LOGIN_LOCKED",
        detail: "로그인에 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.",
        retryAfterSeconds: 61,
      }),
    );

    expect(await login({ email: "a@ssafy.com", password: "abcd1234" })).toEqual({
      formError: "로그인에 여러 번 실패했어요. 2분 뒤에 다시 시도해 주세요.",
    });
  });

  it("남은 시간이 없으면 서버 문구를 그대로 쓴다", async () => {
    post.mockRejectedValue(
      problem(429, {
        code: "LOGIN_LOCKED",
        detail: "로그인에 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.",
      }),
    );

    expect(await login({ email: "a@ssafy.com", password: "abcd1234" })).toEqual({
      formError: "로그인에 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.",
    });
  });
});

describe("requestPasswordReset", () => {
  it("앞뒤 공백을 지운 이메일을 1.8로 보내고 성공을 돌려준다", async () => {
    post.mockResolvedValue({ data: "" });

    expect(await requestPasswordReset({ email: " a@ssafy.com " })).toEqual({ ok: true });
    expect(post).toHaveBeenCalledWith("/auth/password-reset", { email: "a@ssafy.com" });
  });

  it("형식이 틀리면 서버에 묻지 않는다", async () => {
    expect(await requestPasswordReset({ email: "not-email" })).toEqual({
      formError: "이메일을 확인해 주세요.",
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려준다", async () => {
    post.mockRejectedValue(new Error("network"));

    expect(await requestPasswordReset({ email: "a@ssafy.com" })).toEqual({
      formError: "잠시 후 다시 시도해 주세요.",
    });
  });

  it("VALIDATION_FAILED의 email은 칸 오류로 바꾼다", async () => {
    post.mockRejectedValue(
      problem(400, {
        code: "VALIDATION_FAILED",
        detail: "입력값을 확인해 주세요.",
        errors: [{ field: "email", reason: "이메일 형식이 아닙니다." }],
      }),
    );

    expect(await requestPasswordReset({ email: "a@ssafy.com" })).toEqual({
      fieldErrors: { email: "이메일 형식이 아닙니다." },
    });
  });
});

describe("resetPassword", () => {
  const values = { password: "efgh5678", passwordConfirm: "efgh5678" };

  it("token과 새 비밀번호를 1.9로 보내고, 모든 기기가 로그아웃되므로 이 브라우저의 토큰도 지운다", async () => {
    post.mockResolvedValue({ data: "" });

    expect(await resetPassword("token-1", values)).toEqual({ ok: true });
    expect(post).toHaveBeenCalledWith("/auth/password-reset/confirm", {
      token: "token-1",
      newPassword: "efgh5678",
    });
    expect(cookieStore.delete).toHaveBeenCalledWith("hk_access");
    expect(cookieStore.delete).toHaveBeenCalledWith("hk_refresh");
  });

  it("token 칸이 형식 검사(VALIDATION_FAILED)에 걸리면 사용자가 고칠 수 없으니 링크 무효로 본다", async () => {
    post.mockRejectedValue(
      problem(400, {
        code: "VALIDATION_FAILED",
        detail: "입력값을 확인해 주세요.",
        errors: [{ field: "token", reason: "최대 100자입니다." }],
      }),
    );

    expect(await resetPassword("x".repeat(101), values)).toEqual({ linkInvalid: true });
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("PASSWORD_RESET_TOKEN_INVALID면 링크 무효로 알리고 서버 문구를 돌려준다", async () => {
    post.mockRejectedValue(
      problem(400, {
        code: "PASSWORD_RESET_TOKEN_INVALID",
        detail: "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.",
      }),
    );

    expect(await resetPassword("used", values)).toEqual({
      linkInvalid: true,
      formError: "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.",
    });
  });

  it("VALIDATION_FAILED의 newPassword는 칸 오류로 바꾼다", async () => {
    post.mockRejectedValue(
      problem(400, {
        code: "VALIDATION_FAILED",
        detail: "입력값을 확인해 주세요.",
        errors: [{ field: "newPassword", reason: "8~64자, 영문과 숫자를 모두 포함해야 합니다." }],
      }),
    );

    expect(await resetPassword("token-1", values)).toEqual({
      fieldErrors: { newPassword: "8~64자, 영문과 숫자를 모두 포함해야 합니다." },
    });
  });

  it("서버에 닿지 못하면 다시 시도 안내를 돌려주고 쿠키는 그대로 둔다", async () => {
    post.mockRejectedValue(new Error("network"));

    expect(await resetPassword("token-1", values)).toEqual({
      formError: "잠시 후 다시 시도해 주세요.",
    });
    expect(cookieStore.delete).not.toHaveBeenCalled();
  });

  it("확인 칸이 다르면 서버에 보내지 않는다", async () => {
    expect(
      await resetPassword("token-1", { password: "efgh5678", passwordConfirm: "other5678" }),
    ).toEqual({ formError: "입력값을 확인해 주세요." });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("signup", () => {
  it("녹화 동의를 포함한 약관 3개를 보내고, 성공하면 쿠키를 저장한다", async () => {
    post.mockResolvedValue({ data: tokens });

    expect(await signup(signupValues)).toEqual({ ok: true });

    expect(post).toHaveBeenCalledWith("/auth/signup", {
      nickname: "면접왕",
      email: "a@ssafy.com",
      password: "abcd1234",
      agreements: [
        { termsType: "TERMS", termsVersion: "1.0" },
        { termsType: "PRIVACY", termsVersion: "1.0" },
        { termsType: "RECORDING", termsVersion: "1.1" },
      ],
    });
    expect(cookieStore.set).toHaveBeenCalledTimes(2);
  });

  it("VALIDATION_FAILED는 칸별 오류로 바꾼다", async () => {
    post.mockRejectedValue(
      problem(400, {
        code: "VALIDATION_FAILED",
        detail: "입력값을 확인해 주세요.",
        errors: [{ field: "password", reason: "8~64자, 영문과 숫자를 모두 포함해야 합니다." }],
      }),
    );

    expect(await signup(signupValues)).toEqual({
      fieldErrors: { password: "8~64자, 영문과 숫자를 모두 포함해야 합니다." },
    });
  });

  it("EMAIL_DUPLICATED는 이메일 칸 오류로 바꾼다", async () => {
    post.mockRejectedValue(
      problem(409, { code: "EMAIL_DUPLICATED", detail: "이미 사용 중인 이메일이에요." }),
    );

    expect(await signup(signupValues)).toEqual({
      fieldErrors: { email: "이미 사용 중인 이메일이에요." },
    });
  });

  it.each([
    ["약관", { AGE: true, TERMS: true, PRIVACY: true, RECORDING: false }],
    ["만 14세 이상 확인", { AGE: false, TERMS: true, PRIVACY: true, RECORDING: true }],
  ])("%s이 빠진 값은 서버에 보내지 않는다", async (_, agreements) => {
    const result = await signup({ ...signupValues, agreements });

    expect(result.formError).toBeDefined();
    expect(post).not.toHaveBeenCalled();
  });
});

describe("checkEmailAvailable", () => {
  it("형식이 맞으면 서버 결과를 돌려준다", async () => {
    get.mockResolvedValue({ data: { available: false } });

    expect(await checkEmailAvailable("a@ssafy.com")).toBe(false);
    expect(get).toHaveBeenCalledWith("/auth/email-availability", {
      params: { email: "a@ssafy.com" },
    });
  });

  it("형식이 틀리면 서버에 묻지 않고 null", async () => {
    expect(await checkEmailAvailable("a@")).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  // 기준: 웹 Swagger 1.5 로그아웃(Bearer · { refreshToken } · 204) · 공통 401 TOKEN_EXPIRED · 1.4 재발급
  const stored = (cookies: Record<string, string>) =>
    cookieStore.get.mockImplementation((name: string) =>
      name in cookies ? { value: cookies[name] } : undefined,
    );
  const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
  const renewed = { accessToken: "access2", refreshToken: "refresh2", expiresIn: 3600 };

  function expectSignedOut() {
    expect(cookieStore.delete).toHaveBeenCalledWith("hk_access");
    expect(cookieStore.delete).toHaveBeenCalledWith("hk_refresh");
  }

  it("액세스 토큰을 Bearer로 붙여 리프레시 토큰을 폐기하고, 쿠키를 지운 뒤 랜딩으로 보낸다", async () => {
    stored({ hk_access: "access", hk_refresh: "refresh" });
    post.mockResolvedValue({ status: 204 });

    await expect(logout()).rejects.toThrow(redirectTo("/"));

    expect(post).toHaveBeenCalledExactlyOnceWith(
      "/auth/logout",
      { refreshToken: "refresh" },
      bearer("access"),
    );
    expect(refreshTokens).not.toHaveBeenCalled();
    expectSignedOut();
  });

  it("401 TOKEN_EXPIRED면 1.4로 새 토큰을 받아 새 토큰으로 다시 보낸다", async () => {
    stored({ hk_access: "access", hk_refresh: "refresh" });
    // 서버는 보낸 액세스 토큰으로 답을 정한다: 옛 토큰이면 만료, 새 토큰이면 204.
    post.mockImplementation(
      async (_url: string, _body: unknown, config: { headers: { Authorization?: string } }) => {
        if (config.headers.Authorization === "Bearer access") {
          throw problem(401, { code: "TOKEN_EXPIRED" });
        }
        return { status: 204 };
      },
    );
    refreshTokens.mockResolvedValue(renewed);

    await expect(logout()).rejects.toThrow(redirectTo("/"));

    expect(refreshTokens).toHaveBeenCalledExactlyOnceWith("refresh");
    expect(post).toHaveBeenCalledTimes(2);
    expect(post).toHaveBeenNthCalledWith(
      1,
      "/auth/logout",
      { refreshToken: "refresh" },
      bearer("access"),
    );
    expect(post).toHaveBeenNthCalledWith(
      2,
      "/auth/logout",
      { refreshToken: "refresh2" },
      bearer("access2"),
    );
    expectSignedOut();
  });

  it("액세스 토큰 쿠키가 없으면 Bearer 없이 보낸다", async () => {
    stored({ hk_refresh: "refresh" });
    post.mockRejectedValueOnce(problem(401, { code: "UNAUTHORIZED" }));

    await expect(logout()).rejects.toThrow(redirectTo("/"));

    expect(post).toHaveBeenCalledExactlyOnceWith(
      "/auth/logout",
      { refreshToken: "refresh" },
      { headers: {} },
    );
    expect(refreshTokens).not.toHaveBeenCalled();
    expectSignedOut();
  });

  it("재발급이 REFRESH_TOKEN_INVALID(null)면 1.5는 보내지 않고 로그아웃을 마친다", async () => {
    stored({ hk_access: "access", hk_refresh: "refresh" });
    post.mockRejectedValueOnce(problem(401, { code: "TOKEN_EXPIRED" }));
    refreshTokens.mockResolvedValue(null);

    await expect(logout()).rejects.toThrow(redirectTo("/"));

    expect(post).toHaveBeenCalledTimes(1);
    expectSignedOut();
  });

  it.each([
    ["401 UNAUTHORIZED", problem(401, { code: "UNAUTHORIZED" })],
    ["500 INTERNAL_ERROR", problem(500, { code: "INTERNAL_ERROR" })],
    ["연결 오류", new AxiosError("Network Error")],
  ])("그 밖의 실패(%s)는 재발급 없이 쿠키를 지우고 랜딩으로 보낸다", async (_, error) => {
    stored({ hk_access: "access", hk_refresh: "refresh" });
    post.mockRejectedValueOnce(error);

    await expect(logout()).rejects.toThrow(redirectTo("/"));

    expect(refreshTokens).not.toHaveBeenCalled();
    expectSignedOut();
  });

  it("재발급 자체가 실패(500 등 throw)해도 쿠키를 지우고 랜딩으로 보낸다", async () => {
    stored({ hk_access: "access", hk_refresh: "refresh" });
    post.mockRejectedValueOnce(problem(401, { code: "TOKEN_EXPIRED" }));
    refreshTokens.mockRejectedValue(problem(500, { code: "INTERNAL_ERROR" }));

    await expect(logout()).rejects.toThrow(redirectTo("/"));

    expect(post).toHaveBeenCalledTimes(1);
    expectSignedOut();
  });

  it("리프레시 토큰 쿠키가 없으면 보내지 않고 쿠키만 지운다", async () => {
    stored({ hk_access: "access" });

    await expect(logout()).rejects.toThrow(redirectTo("/"));

    expect(post).not.toHaveBeenCalled();
    expect(refreshTokens).not.toHaveBeenCalled();
    expectSignedOut();
  });
});
