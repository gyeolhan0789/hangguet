// @vitest-environment node
// 기준: Swagger 1.1 이메일 중복 확인 · 1.2 회원가입 · 1.3 로그인 · 1.5 로그아웃 · 1.8 비밀번호 찾기 · 1.9 비밀번호 재설정 · 공통 401 TOKEN_EXPIRED
import { describe, expect, it, vi } from "vitest";

import { redirect } from "next/navigation";

import { cookieValue, setCookie } from "@/test/next-headers";
import { redirectTo } from "@/test/redirect";
import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import type { TokenResponse } from "@/types/api";

import {
  checkEmailAvailable,
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  signup,
} from "./actions";

// 경계 mock: 토큰 없이 보내는 HTTP(plainClient) · 재발급(1.4)과 Next 런타임(쿠키 · redirect)
const http = vi.hoisted(() => ({
  plainClient: { post: vi.fn(), get: vi.fn() },
  refreshTokens: vi.fn(),
}));
vi.mock("@/lib/api/token-refresh", () => http);
vi.mock("next/headers", () => import("@/test/next-headers"));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
const { plainClient, refreshTokens } = http;

// 예시 데이터: Swagger 1.2 · 1.3 요청 예시와 응답 모양(TokenResponse)
const TOKEN: TokenResponse = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 3600,
  user: { id: 1, email: "a@ssafy.com", nickname: "면접왕", profileImageUrl: null },
};
const LOGIN_VALUES = { email: "a@ssafy.com", password: "abcd1234" };
const SIGNUP_VALUES = {
  nickname: "면접왕",
  email: "a@ssafy.com",
  password: "abcd1234",
  passwordConfirm: "abcd1234",
  agreements: { AGE: true, TERMS: true, PRIVACY: true, RECORDING: true },
};
const RESET_VALUES = { password: "abcd1234", passwordConfirm: "abcd1234" };

// 예시 데이터: Swagger 1.3 429 · 1.2 409 · 1.2 400 · 1.9 400 예시
const LOGIN_LOCKED = {
  title: "Too Many Requests",
  status: 429,
  detail: "로그인에 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.",
  instance: "/api/v1/auth/login",
  code: "LOGIN_LOCKED",
  retryAfterSeconds: 900,
};
const EMAIL_DUPLICATED = {
  title: "Conflict",
  status: 409,
  detail: "이미 사용 중인 이메일이에요.",
  instance: "/api/v1/auth/signup",
  code: "EMAIL_DUPLICATED",
};
const VALIDATION_FAILED = {
  title: "Bad Request",
  status: 400,
  detail: "입력값을 확인해 주세요.",
  instance: "/api/v1/auth/signup",
  code: "VALIDATION_FAILED",
};
const PASSWORD_REASON = "8~64자, 영문과 숫자를 모두 포함해야 합니다.";
const PASSWORD_RESET_TOKEN_INVALID = {
  title: "Bad Request",
  status: 400,
  detail: "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.",
  instance: "/api/v1/auth/password-reset/confirm",
  code: "PASSWORD_RESET_TOKEN_INVALID",
};
// 공통 401(API별 예시가 없어 모양만 맞춘다)
const TOKEN_EXPIRED = { title: "Unauthorized", status: 401, code: "TOKEN_EXPIRED" };
const UNAUTHORIZED = { title: "Unauthorized", status: 401, code: "UNAUTHORIZED" };

function signedIn() {
  setCookie("hk_access", "access-1");
  setCookie("hk_refresh", "refresh-1");
}

describe("login · 이메일 로그인", () => {
  describe("정상 처리", () => {
    it("로그인하면 토큰을 쿠키에 저장하고 홈으로 보낸다", async () => {
      plainClient.post.mockResolvedValue({ data: TOKEN });

      await expect(login(LOGIN_VALUES)).rejects.toThrow(redirectTo("/home"));
      expect(cookieValue("hk_access")).toBe("access-1");
      expect(cookieValue("hk_refresh")).toBe("refresh-1");
    });
  });

  describe("입력 검증", () => {
    it("입력이 규칙에 맞지 않으면 요청하지 않고 확인 안내를 돌려준다", async () => {
      expect(await login({ email: "a@ssafy.com", password: "" })).toEqual({
        formError: "이메일 또는 비밀번호를 확인해 주세요.",
      });
      expect(plainClient.post).not.toHaveBeenCalled();
    });
  });

  describe("경계값", () => {
    it.each([
      { seconds: 1, minutes: 1 },
      { seconds: 60, minutes: 1 },
      { seconds: 61, minutes: 2 },
    ])(
      "잠김(429 LOGIN_LOCKED) 남은 시간이 '$seconds'초면 '$minutes'분 뒤로 안내한다",
      async ({ seconds, minutes }) => {
        plainClient.post.mockRejectedValue(
          axiosProblem({ ...LOGIN_LOCKED, retryAfterSeconds: seconds }),
        );

        expect(await login(LOGIN_VALUES)).toEqual({
          formError: `로그인에 여러 번 실패했어요. ${minutes}분 뒤에 다시 시도해 주세요.`,
        });
      },
    );

    it.each([
      { label: "없음", retryAfterSeconds: undefined },
      { label: "0", retryAfterSeconds: 0 },
    ])("잠김 남은 시간이 '$label'이면 서버 문구를 그대로 쓴다", async ({ retryAfterSeconds }) => {
      // Swagger 예시 detail은 정해 둔 잠김 문구 · 다시 시도 안내와 글자가 같아 서버 문구 경로를 가릴 수 없으므로 detail만 바꾼다
      plainClient.post.mockRejectedValue(
        axiosProblem({
          ...LOGIN_LOCKED,
          detail: "로그인이 잠겼어요. 15분 뒤에 와 주세요.",
          retryAfterSeconds,
        }),
      );

      expect(await login(LOGIN_VALUES)).toEqual({
        formError: "로그인이 잠겼어요. 15분 뒤에 와 주세요.",
      });
    });

    it("잠김 남은 시간도 서버 문구도 없으면 정해 둔 잠김 문구를 쓴다", async () => {
      const withoutBoth = { ...LOGIN_LOCKED, detail: undefined, retryAfterSeconds: undefined };
      plainClient.post.mockRejectedValue(axiosProblem(withoutBoth));

      expect(await login(LOGIN_VALUES)).toEqual({
        formError: "로그인에 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.",
      });
    });
  });

  describe("오류 처리", () => {
    it("서버가 칸을 거절하면(VALIDATION_FAILED) 이메일 · 비밀번호 칸 오류로 돌려주고 쿠키를 만들지 않는다", async () => {
      plainClient.post.mockRejectedValue(
        axiosProblem({
          ...VALIDATION_FAILED,
          instance: "/api/v1/auth/login",
          errors: [
            { field: "email", reason: "이메일 형식이 아닙니다." },
            { field: "password", reason: "64자까지입니다." },
          ],
        }),
      );

      expect(await login(LOGIN_VALUES)).toEqual({
        fieldErrors: { email: "이메일 형식이 아닙니다.", password: "64자까지입니다." },
      });
      expect(cookieValue("hk_access")).toBeUndefined();
    });
  });
});

describe("signup · 회원가입", () => {
  describe("정상 처리", () => {
    it("가입하면 토큰을 쿠키에 저장하고 ok를 돌려준다(이동은 화면이 한다)", async () => {
      plainClient.post.mockResolvedValue({ data: TOKEN });

      expect(await signup(SIGNUP_VALUES)).toEqual({ ok: true });
      expect(cookieValue("hk_access")).toBe("access-1");
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe("입력 검증", () => {
    it("입력이 규칙에 맞지 않으면 요청하지 않고 확인 안내를 돌려준다", async () => {
      expect(await signup({ ...SIGNUP_VALUES, passwordConfirm: "abcd9999" })).toEqual({
        formError: "입력값을 확인해 주세요.",
      });
      expect(plainClient.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("이미 쓰는 이메일이면(409 EMAIL_DUPLICATED) 서버 문구를 이메일 칸 오류로 돌려준다", async () => {
      plainClient.post.mockRejectedValue(axiosProblem(EMAIL_DUPLICATED));

      expect(await signup(SIGNUP_VALUES)).toEqual({
        fieldErrors: { email: "이미 사용 중인 이메일이에요." },
      });
    });

    it("서버가 칸을 거절하면(VALIDATION_FAILED) 닉네임 · 이메일 · 비밀번호 칸 오류로 돌려준다", async () => {
      plainClient.post.mockRejectedValue(
        axiosProblem({
          ...VALIDATION_FAILED,
          errors: [
            { field: "nickname", reason: "50자까지입니다." },
            { field: "email", reason: "이메일 형식이 아닙니다." },
            { field: "password", reason: PASSWORD_REASON },
          ],
        }),
      );

      expect(await signup(SIGNUP_VALUES)).toEqual({
        fieldErrors: {
          nickname: "50자까지입니다.",
          email: "이메일 형식이 아닙니다.",
          password: PASSWORD_REASON,
        },
      });
    });
  });
});

describe("checkEmailAvailable · 이메일 중복 확인", () => {
  describe("입력 검증", () => {
    it("형식이 틀리면 요청하지 않고 null을 돌려준다", async () => {
      expect(await checkEmailAvailable("a@")).toBeNull();
      expect(plainClient.get).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("확인에 실패하면 null을 돌려준다", async () => {
      plainClient.get.mockRejectedValue(axiosNoResponse());

      expect(await checkEmailAvailable("a@ssafy.com")).toBeNull();
    });
  });
});

describe("requestPasswordReset · 비밀번호 찾기 메일 요청", () => {
  describe("정상 처리", () => {
    it("요청에 성공하면 ok를 돌려준다", async () => {
      plainClient.post.mockResolvedValue({ status: 204 });

      expect(await requestPasswordReset({ email: "a@ssafy.com" })).toEqual({ ok: true });
    });
  });

  describe("입력 검증", () => {
    it("형식이 틀리면 요청하지 않고 확인 안내를 돌려준다", async () => {
      expect(await requestPasswordReset({ email: "a@" })).toEqual({
        formError: "이메일을 확인해 주세요.",
      });
      expect(plainClient.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("서버가 이메일을 거절하면(VALIDATION_FAILED) 이메일 칸 오류로 돌려준다", async () => {
      plainClient.post.mockRejectedValue(
        axiosProblem({
          ...VALIDATION_FAILED,
          instance: "/api/v1/auth/password-reset",
          errors: [{ field: "email", reason: "이메일 형식이 아닙니다." }],
        }),
      );

      expect(await requestPasswordReset({ email: "a@ssafy.com" })).toEqual({
        fieldErrors: { email: "이메일 형식이 아닙니다." },
      });
    });
  });
});

describe("resetPassword · 비밀번호 재설정", () => {
  describe("정상 처리", () => {
    it("바꾸면 이 브라우저의 토큰 쿠키도 지우고 ok를 돌려준다", async () => {
      signedIn();
      plainClient.post.mockResolvedValue({ status: 204 });

      expect(await resetPassword("reset-token", RESET_VALUES)).toEqual({ ok: true });
      expect(cookieValue("hk_access")).toBeUndefined();
      expect(cookieValue("hk_refresh")).toBeUndefined();
    });
  });

  describe("입력 검증", () => {
    it("비밀번호 확인이 다르면 요청하지 않고 확인 안내를 돌려준다", async () => {
      expect(
        await resetPassword("reset-token", { password: "abcd1234", passwordConfirm: "abcd9999" }),
      ).toEqual({ formError: "입력값을 확인해 주세요." });
      expect(plainClient.post).not.toHaveBeenCalled();
    });
  });

  describe("오류 처리", () => {
    it("링크가 무효면(400 PASSWORD_RESET_TOKEN_INVALID) 링크 무효와 서버 문구를 돌려준다", async () => {
      plainClient.post.mockRejectedValue(axiosProblem(PASSWORD_RESET_TOKEN_INVALID));

      expect(await resetPassword("reset-token", RESET_VALUES)).toEqual({
        linkInvalid: true,
        formError: "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.",
      });
    });

    it("token이 형식 검사에 걸리면(VALIDATION_FAILED token) 문구 없이 링크 무효로 본다", async () => {
      plainClient.post.mockRejectedValue(
        axiosProblem({
          ...VALIDATION_FAILED,
          instance: "/api/v1/auth/password-reset/confirm",
          errors: [{ field: "token", reason: "필수입니다." }],
        }),
      );

      expect(await resetPassword("reset-token", RESET_VALUES)).toEqual({ linkInvalid: true });
    });

    it("서버가 새 비밀번호를 거절하면(VALIDATION_FAILED newPassword) 칸 오류로 돌려주고 쿠키는 그대로 둔다", async () => {
      signedIn();
      plainClient.post.mockRejectedValue(
        axiosProblem({
          ...VALIDATION_FAILED,
          instance: "/api/v1/auth/password-reset/confirm",
          errors: [{ field: "newPassword", reason: PASSWORD_REASON }],
        }),
      );

      expect(await resetPassword("reset-token", RESET_VALUES)).toEqual({
        fieldErrors: { newPassword: PASSWORD_REASON },
      });
      expect(cookieValue("hk_access")).toBe("access-1");
    });
  });
});

describe("logout · 로그아웃", () => {
  describe("정상 처리", () => {
    it("리프레시 토큰을 폐기하고 쿠키를 지운 뒤 랜딩으로 보낸다", async () => {
      signedIn();
      plainClient.post.mockResolvedValue({ status: 204 });

      await expect(logout()).rejects.toThrow(redirectTo("/"));
      expect(plainClient.post).toHaveBeenCalledTimes(1);
      expect(plainClient.post.mock.calls[0][2].headers.Authorization).toContain("access-1");
      expect(cookieValue("hk_access")).toBeUndefined();
      expect(cookieValue("hk_refresh")).toBeUndefined();
    });
  });

  describe("경계값", () => {
    it("리프레시 토큰 쿠키가 없으면 요청하지 않고 쿠키만 지운 뒤 랜딩으로 보낸다", async () => {
      setCookie("hk_access", "access-1");

      await expect(logout()).rejects.toThrow(redirectTo("/"));
      expect(plainClient.post).not.toHaveBeenCalled();
      expect(cookieValue("hk_access")).toBeUndefined();
    });
  });

  describe("오류 처리", () => {
    it("만료가 아닌 이유로 폐기에 실패하면 재발급하지 않고 쿠키를 지운 뒤 랜딩으로 보낸다", async () => {
      signedIn();
      plainClient.post.mockRejectedValue(axiosProblem(UNAUTHORIZED));

      await expect(logout()).rejects.toThrow(redirectTo("/"));
      expect(refreshTokens).not.toHaveBeenCalled();
      expect(cookieValue("hk_access")).toBeUndefined();
      expect(cookieValue("hk_refresh")).toBeUndefined();
    });
  });

  describe("권한 · 로그인", () => {
    it("액세스 토큰이 만료(401 TOKEN_EXPIRED)면 재발급한 새 토큰으로 다시 폐기를 요청한다", async () => {
      signedIn();
      plainClient.post
        .mockRejectedValueOnce(axiosProblem(TOKEN_EXPIRED))
        .mockResolvedValueOnce({ status: 204 });
      refreshTokens.mockResolvedValue({
        accessToken: "access-new",
        refreshToken: "refresh-new",
        expiresIn: 3600,
      });

      await expect(logout()).rejects.toThrow(redirectTo("/"));
      expect(refreshTokens).toHaveBeenCalledWith("refresh-1");
      expect(plainClient.post).toHaveBeenCalledTimes(2);
      const [, retryBody, retryConfig] = plainClient.post.mock.calls[1];
      expect(retryBody).toEqual({ refreshToken: "refresh-new" });
      expect(retryConfig.headers.Authorization).toContain("access-new");
    });

    it("재발급이 무효(null)면 다시 요청하지 않고 로그아웃을 마친다", async () => {
      signedIn();
      plainClient.post.mockRejectedValue(axiosProblem(TOKEN_EXPIRED));
      refreshTokens.mockResolvedValue(null);

      await expect(logout()).rejects.toThrow(redirectTo("/"));
      expect(plainClient.post).toHaveBeenCalledTimes(1);
      expect(cookieValue("hk_refresh")).toBeUndefined();
    });

    it("재발급 자체가 실패해도 쿠키를 지우고 랜딩으로 보낸다", async () => {
      signedIn();
      plainClient.post.mockRejectedValue(axiosProblem(TOKEN_EXPIRED));
      refreshTokens.mockRejectedValue(axiosNoResponse());

      await expect(logout()).rejects.toThrow(redirectTo("/"));
      expect(cookieValue("hk_access")).toBeUndefined();
      expect(cookieValue("hk_refresh")).toBeUndefined();
    });
  });
});
