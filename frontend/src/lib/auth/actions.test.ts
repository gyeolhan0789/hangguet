// @vitest-environment node
import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";

const post = vi.fn();
const get = vi.fn();
vi.mock("@/lib/api/client", () => ({ api: { post, get } }));

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT ${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const { checkEmailAvailable, login, logout, signup } = await import("./actions");

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
  agreements: { TERMS: true },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("login", () => {
  it("성공하면 토큰을 쿠키에 저장하고 홈으로 보낸다", async () => {
    post.mockResolvedValue({ data: tokens });

    await expect(login({ email: "a@ssafy.com", password: "abcd1234" })).rejects.toThrow(
      "REDIRECT /home",
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

describe("signup", () => {
  it("서비스·개인정보 통합 약관 1개를 보내고, 성공하면 쿠키를 저장한다", async () => {
    post.mockResolvedValue({ data: tokens });

    expect(await signup(signupValues)).toEqual({ ok: true });

    expect(post).toHaveBeenCalledWith("/auth/signup", {
      nickname: "면접왕",
      email: "a@ssafy.com",
      password: "abcd1234",
      agreements: [{ termsType: "TERMS", termsVersion: "1.0" }],
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

  it("약관이 빠진 값은 서버에 보내지 않는다", async () => {
    const result = await signup({
      ...signupValues,
      agreements: { TERMS: false },
    });

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
  it("리프레시 토큰을 폐기하고 쿠키를 지운 뒤 랜딩으로 보낸다", async () => {
    cookieStore.get.mockReturnValue({ value: "refresh" });
    post.mockResolvedValue({ status: 204 });

    await expect(logout()).rejects.toThrow("REDIRECT /");

    expect(post).toHaveBeenCalledWith("/auth/logout", { refreshToken: "refresh" });
    expect(cookieStore.delete).toHaveBeenCalledWith("hk_access");
    expect(cookieStore.delete).toHaveBeenCalledWith("hk_refresh");
  });
});
