// @vitest-environment node
// 기준: Swagger 1.7 소셜 회원가입(201 · 401 SIGNUP_TOKEN_INVALID · 409 SOCIAL_EMAIL_DUPLICATED) · 기획 메모 S01-3 · 카카오 REST API '인가 코드 받기'
import { describe, expect, it, vi } from "vitest";

import { redirect } from "next/navigation";

import { RETRY_LATER } from "@/lib/api/problem-detail";
import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import { cookieValue, setCookie } from "@/test/next-headers";
import { redirectTo } from "@/test/redirect";
import type { TokenResponse } from "@/types/api";

import { SIGNUP_TOKEN_INVALID, SOCIAL_LOGIN_FAILED, SOCIAL_LOGIN_UNAVAILABLE } from "./kakao";
import { socialSignup, startKakaoLogin } from "./social-actions";

// 경계 mock: 토큰 없이 보내는 HTTP(plainClient)와 Next 런타임(쿠키 · redirect), 카카오 설정(환경 변수)
const http = vi.hoisted(() => ({ plainClient: { post: vi.fn() } }));
vi.mock("@/lib/api/token-refresh", () => http);
vi.mock("next/headers", () => import("@/test/next-headers"));
vi.mock("next/navigation", () => import("@/test/next-navigation"));
const { plainClient } = http;

// 예시 데이터: Swagger 1.7 요청 · 응답 모양(TokenResponse)과 401 · 409 예시
const TOKEN: TokenResponse = {
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresIn: 3600,
  user: { id: 1, email: "a@kakao.com", nickname: "면접왕", profileImageUrl: null },
};
const ALL_AGREED = { AGE: true, TERMS: true, PRIVACY: true, RECORDING: true };
const SIGNUP_TOKEN_INVALID_PROBLEM = {
  title: "Unauthorized",
  status: 401,
  detail: "가입 시간이 지났어요. 다시 로그인해 주세요.",
  instance: "/api/v1/auth/oauth/signup",
  code: "SIGNUP_TOKEN_INVALID",
};
const SOCIAL_EMAIL_DUPLICATED_PROBLEM = {
  title: "Conflict",
  status: 409,
  detail: "이미 가입한 이메일이에요. 처음 가입한 방법으로 로그인해 주세요.",
  instance: "/api/v1/auth/oauth/kakao",
  code: "SOCIAL_EMAIL_DUPLICATED",
};
// 예시 데이터: Swagger 공통 500 예시
const INTERNAL_ERROR = {
  title: "Internal Server Error",
  status: 500,
  detail: "잠시 후 다시 시도해 주세요.",
  instance: "/api/v1/auth/oauth/signup",
  code: "INTERNAL_ERROR",
};

/** S01에 한 번 보여 줄 문구 쿠키(hk_notice) */
function loginNotice() {
  return JSON.parse(cookieValue("hk_notice") ?? "null") as unknown;
}

describe("startKakaoLogin · 카카오 로그인 시작", () => {
  describe("정상 처리", () => {
    it("state를 쿠키에 담고 그 state로 카카오 인가 화면으로 보낸다", async () => {
      vi.stubEnv("KAKAO_CLIENT_ID", "kakao-rest-key");
      vi.stubEnv("KAKAO_REDIRECT_URI", "https://hangguet.yobistory.com/oauth/kakao/callback");

      await expect(startKakaoLogin()).rejects.toThrow(/^REDIRECT https:\/\/kauth\.kakao\.com\//);
      const sentState = new URL(vi.mocked(redirect).mock.calls[0][0]).searchParams.get("state");
      expect(cookieValue("hk_oauth_state")).toBe(`login.${sentState}`);
    });

    it("닫지 않고 떠난 예전 가입 토큰을 지운다", async () => {
      vi.stubEnv("KAKAO_CLIENT_ID", "kakao-rest-key");
      vi.stubEnv("KAKAO_REDIRECT_URI", "https://hangguet.yobistory.com/oauth/kakao/callback");
      setCookie("hk_social_signup", "signup-token-old");

      await expect(startKakaoLogin()).rejects.toThrow();
      expect(cookieValue("hk_social_signup")).toBe("");
    });
  });

  describe("오류 처리", () => {
    it("카카오 설정이 없으면 로그인 화면으로 돌아가 연결 실패 문구를 남긴다", async () => {
      vi.stubEnv("KAKAO_CLIENT_ID", "");
      vi.stubEnv("KAKAO_REDIRECT_URI", "");

      await expect(startKakaoLogin()).rejects.toThrow(redirectTo("/login"));
      expect(loginNotice()).toEqual({ target: "login", text: SOCIAL_LOGIN_UNAVAILABLE });
    });
  });
});

describe("socialSignup · 카카오 회원가입", () => {
  describe("정상 처리", () => {
    it("가입하면 로그인 토큰을 저장하고 가입 토큰을 지운 뒤 홈으로 보낸다", async () => {
      setCookie("hk_social_signup", "signup-token-1");
      plainClient.post.mockResolvedValue({ data: TOKEN });

      await expect(socialSignup(ALL_AGREED)).rejects.toThrow(redirectTo("/home"));
      expect(cookieValue("hk_access")).toBe("access-1");
      expect(cookieValue("hk_refresh")).toBe("refresh-1");
      expect(cookieValue("hk_social_signup")).toBe("");
    });
  });

  describe("입력 검증", () => {
    it("필수 동의가 빠졌으면 요청하지 않고 로그인 화면에 정해 둔 실패 문구를 남긴다", async () => {
      setCookie("hk_social_signup", "signup-token-1");

      await expect(socialSignup({ ...ALL_AGREED, RECORDING: false })).rejects.toThrow(
        redirectTo("/login"),
      );
      expect(plainClient.post).not.toHaveBeenCalled();
      expect(loginNotice()).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
    });
  });

  describe("오류 처리", () => {
    it.each([
      { code: "SIGNUP_TOKEN_INVALID", problem: SIGNUP_TOKEN_INVALID_PROBLEM },
      { code: "SOCIAL_EMAIL_DUPLICATED", problem: SOCIAL_EMAIL_DUPLICATED_PROBLEM },
    ])("고칠 수 있는 오류('$code')면 서버 문구를 로그인 화면에 남긴다", async ({ problem }) => {
      setCookie("hk_social_signup", "signup-token-1");
      plainClient.post.mockRejectedValue(axiosProblem(problem));

      await expect(socialSignup(ALL_AGREED)).rejects.toThrow(redirectTo("/login"));
      expect(loginNotice()).toEqual({ target: "login", text: problem.detail });
    });

    it("고칠 수 없는 오류(500 INTERNAL_ERROR)면 정해 둔 실패 문구를 남긴다", async () => {
      setCookie("hk_social_signup", "signup-token-1");
      plainClient.post.mockRejectedValue(axiosProblem(INTERNAL_ERROR));

      await expect(socialSignup(ALL_AGREED)).rejects.toThrow(redirectTo("/login"));
      expect(loginNotice()).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
    });

    it("보여 줄 코드여도 서버 문구가 비어 있으면 정해 둔 실패 문구를 남긴다", async () => {
      setCookie("hk_social_signup", "signup-token-1");
      plainClient.post.mockRejectedValue(
        axiosProblem({ ...SIGNUP_TOKEN_INVALID_PROBLEM, detail: "" }),
      );

      await expect(socialSignup(ALL_AGREED)).rejects.toThrow(redirectTo("/login"));
      expect(loginNotice()).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
    });

    it("서버에 닿지 못하면 다시 시도 안내를 남긴다", async () => {
      setCookie("hk_social_signup", "signup-token-1");
      plainClient.post.mockRejectedValue(axiosNoResponse());

      await expect(socialSignup(ALL_AGREED)).rejects.toThrow(redirectTo("/login"));
      expect(loginNotice()).toEqual({ target: "login", text: RETRY_LATER });
    });

    it("실패하면 가입 토큰을 지우고 로그인 토큰 없이 로그인 화면으로 보낸다", async () => {
      setCookie("hk_social_signup", "signup-token-1");
      plainClient.post.mockRejectedValue(axiosProblem(SIGNUP_TOKEN_INVALID_PROBLEM));

      await expect(socialSignup(ALL_AGREED)).rejects.toThrow(redirectTo("/login"));
      expect(cookieValue("hk_social_signup")).toBe("");
      expect(cookieValue("hk_access")).toBeUndefined();
      expect(cookieValue("hk_refresh")).toBeUndefined();
    });
  });

  describe("권한 · 로그인", () => {
    it("가입 토큰 쿠키가 없으면(유효 시간 지남) 요청하지 않고 가입 시간이 지났다는 문구를 남긴다", async () => {
      await expect(socialSignup(ALL_AGREED)).rejects.toThrow(redirectTo("/login"));
      expect(plainClient.post).not.toHaveBeenCalled();
      expect(loginNotice()).toEqual({ target: "login", text: SIGNUP_TOKEN_INVALID });
    });
  });
});
