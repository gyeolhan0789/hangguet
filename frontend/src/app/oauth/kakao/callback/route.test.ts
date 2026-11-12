// @vitest-environment node
// 기준: 웹 Swagger 1.6 소셜 로그인 · 2.9 연습 알림 켜기 · 2.12 소셜 계정 연결 · 기획 메모 S01-3 · S09-1-B
// · 사용자 결정(연결하면 S09-1에 완료 안내 모달, 2.12 오류는 모두 서버 문구)
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/lib/api/auth-cookies";
import { RETRY_LATER } from "@/lib/api/problem-detail";
import {
  KAKAO_CONSENT_FAILED,
  KAKAO_UNAVAILABLE,
  NOTICE_COOKIE,
  OAUTH_STATE_COOKIE,
  SOCIAL_LINK_FAILED,
  SOCIAL_LOGIN_FAILED,
  SOCIAL_LOGIN_UNAVAILABLE,
  SOCIAL_SIGNUP_COOKIE,
} from "@/lib/auth/kakao";
import { axiosNoResponse, axiosProblem } from "@/test/axios-problem";
import type { ProblemDetail, SocialLoginResponse } from "@/types/api";

import { GET } from "./route";

// 경계 mock: 토큰 없이 보내는 HTTP(plainClient)와 카카오 앱 설정(환경 변수)
const plainClient = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/api/token-refresh", () => ({ plainClient }));

const REDIRECT_URI = "http://localhost:3000/oauth/kakao/callback";

beforeEach(() => {
  vi.stubEnv("KAKAO_CLIENT_ID", "client-id");
  vi.stubEnv("KAKAO_REDIRECT_URI", REDIRECT_URI);
});

// 예시 데이터: Swagger 1.6 200 예시 '가입한 회원' · '처음 온 사람'
const MEMBER: SocialLoginResponse = {
  signupRequired: false,
  token: {
    accessToken: "access-new",
    refreshToken: "refresh-new",
    expiresIn: 3600,
    user: { id: 1, email: "a@kakao.com", nickname: "면접왕", profileImageUrl: null },
  },
  signup: null,
};
const NEWCOMER: SocialLoginResponse = {
  signupRequired: true,
  token: null,
  signup: { signupToken: "Zm9v", email: "a@kakao.com", nickname: "면접왕", expiresIn: 600 },
};

const problem = (body: Pick<ProblemDetail, "status" | "code"> & { detail?: string }) =>
  axiosProblem({ title: "Error", instance: "/api/v1", detail: "", ...body });

/** 카카오가 돌려보내는 콜백 요청. query는 주소의 값, cookies는 브라우저가 실어 보내는 쿠키 */
function callback(query: Record<string, string>, cookies: Record<string, string> = {}) {
  const url = new URL(REDIRECT_URI);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const cookie = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
  return GET(new NextRequest(url, { headers: cookie ? { cookie } : {} }));
}

/** 다음 화면에 한 번 보일 문구 쿠키(없으면 null) */
function notice(response: Awaited<ReturnType<typeof GET>>) {
  const value = response.cookies.get(NOTICE_COOKIE)?.value;
  return value ? (JSON.parse(value) as unknown) : null;
}

const login = (cookies: Record<string, string> = {}) =>
  callback({ code: "c", state: "s" }, { [OAUTH_STATE_COOKIE]: "login.s", ...cookies });
const alarm = () =>
  callback(
    { code: "c", state: "s" },
    { [OAUTH_STATE_COOKIE]: "alarm.s", [ACCESS_TOKEN_COOKIE]: "access-now" },
  );
const link = () =>
  callback(
    { code: "c", state: "s" },
    { [OAUTH_STATE_COOKIE]: "link.s", [ACCESS_TOKEN_COOKIE]: "access-now" },
  );

describe("GET · 카카오 인가 콜백", () => {
  describe("공통", () => {
    describe("사용자 조작", () => {
      it.each([{ purpose: "alarm" }, { purpose: "link" }])(
        "설정 화면에서 시작한 '$purpose' 동의 화면에서 취소하면 문구 없이 설정 화면으로 돌아가고 가입 토큰은 건드리지 않는다",
        async ({ purpose }) => {
          const response = await callback(
            { error: "access_denied", state: "s" },
            { [OAUTH_STATE_COOKIE]: `${purpose}.s`, [ACCESS_TOKEN_COOKIE]: "access-now" },
          );

          expect(plainClient.put).not.toHaveBeenCalled();
          expect(response.headers.get("location")).toBe("/mypage/settings");
          expect(notice(response)).toBeNull();
          expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toBeUndefined();
        },
      );
    });

    describe("정상 처리", () => {
      it("state가 맞으면 state 쿠키를 지운다", async () => {
        plainClient.post.mockResolvedValue({ data: MEMBER });

        const response = await login();

        expect(response.cookies.get(OAUTH_STATE_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
      });
    });

    describe("입력 검증", () => {
      it.each([{ saved: "login" }, { saved: "alarm" }, { saved: "link" }])(
        "로그아웃 상태에서 state가 다르면 API를 부르지 않고 쿠키 용도 '$saved'와 상관없이 로그인 화면에 로그인 실패 문구를 남긴다",
        async ({ saved }) => {
          const response = await callback(
            { code: "c", state: "other" },
            { [OAUTH_STATE_COOKIE]: `${saved}.s` },
          );

          expect(plainClient.post).not.toHaveBeenCalled();
          expect(plainClient.put).not.toHaveBeenCalled();
          expect(response.headers.get("location")).toBe("/login");
          expect(notice(response)).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
        },
      );

      it.each([
        { saved: "link", cookie: "link.s", text: "SOCIAL_LINK_FAILED", shown: SOCIAL_LINK_FAILED },
        {
          saved: "없음",
          cookie: undefined,
          text: "KAKAO_CONSENT_FAILED",
          shown: KAKAO_CONSENT_FAILED,
        },
      ])(
        "로그인한 회원의 state가 다르고 쿠키 용도가 '$saved'이면 설정 화면에 '$text'를 남긴다",
        async ({ cookie, shown }) => {
          const response = await callback(
            { code: "c", state: "other" },
            {
              [ACCESS_TOKEN_COOKIE]: "access-now",
              ...(cookie && { [OAUTH_STATE_COOKIE]: cookie }),
            },
          );

          expect(plainClient.put).not.toHaveBeenCalled();
          expect(response.headers.get("location")).toBe("/mypage/settings");
          expect(notice(response)).toEqual({ target: "settings", text: shown });
        },
      );

      it("state가 다르면 state 쿠키와 예전 가입 토큰을 건드리지 않는다", async () => {
        const response = await callback(
          { code: "c", state: "other" },
          { [OAUTH_STATE_COOKIE]: "login.s", [SOCIAL_SIGNUP_COOKIE]: "old" },
        );

        expect(response.cookies.get(OAUTH_STATE_COOKIE)).toBeUndefined();
        expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toBeUndefined();
      });
    });

    describe("권한 · 로그인", () => {
      it.each([{ purpose: "alarm" }, { purpose: "link" }])(
        "'$purpose' 인가에서 돌아왔는데 그 사이 로그아웃해 토큰이 없으면 API를 부르지 않고 로그인 화면으로 보낸다",
        async ({ purpose }) => {
          const response = await callback(
            { code: "c", state: "s" },
            { [OAUTH_STATE_COOKIE]: `${purpose}.s` },
          );

          expect(plainClient.put).not.toHaveBeenCalled();
          expect(response.headers.get("location")).toBe("/login");
        },
      );
    });
  });

  describe("로그인", () => {
    describe("사용자 조작", () => {
      it("카카오 동의 화면에서 취소하면(access_denied) 1.6을 부르지 않고 문구 없이 로그인 화면으로 돌아간다", async () => {
        const response = await callback(
          { error: "access_denied", state: "s" },
          { [OAUTH_STATE_COOKIE]: "login.s" },
        );

        expect(plainClient.post).not.toHaveBeenCalled();
        expect(response.headers.get("location")).toBe("/login");
        expect(notice(response)).toBeNull();
      });
    });

    describe("정상 처리", () => {
      it("가입한 회원이면 토큰을 저장하고 홈으로 보낸다", async () => {
        plainClient.post.mockResolvedValue({ data: MEMBER });

        const response = await login();

        expect(response.headers.get("location")).toBe("/home");
        expect(response.cookies.get(ACCESS_TOKEN_COOKIE)?.value).toBe("access-new");
        expect(response.cookies.get(REFRESH_TOKEN_COOKIE)?.value).toBe("refresh-new");
        expect(notice(response)).toBeNull();
      });

      it("처음 온 사람이면 가입 토큰을 유효 시간 동안 저장하고 로그인 화면으로 보낸다", async () => {
        plainClient.post.mockResolvedValue({ data: NEWCOMER });

        const response = await login();

        expect(response.headers.get("location")).toBe("/login");
        expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toMatchObject({
          value: "Zm9v",
          maxAge: 600,
        });
        expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
      });

      it("로그인을 마치면 예전 가입 토큰을 지운다", async () => {
        plainClient.post.mockResolvedValue({ data: MEMBER });

        const response = await login({ [SOCIAL_SIGNUP_COOKIE]: "old" });

        expect(response.cookies.get(SOCIAL_SIGNUP_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
      });
    });

    describe("입력 검증", () => {
      it.each<{ label: string; query: Record<string, string> }>([
        { label: "카카오가 다른 오류를 줌", query: { error: "server_error", state: "s" } },
        { label: "인가 코드 없음", query: { state: "s" } },
      ])("'$label'이면 1.6을 부르지 않고 정해 둔 실패 문구를 남긴다", async ({ query }) => {
        const response = await callback(query, { [OAUTH_STATE_COOKIE]: "login.s" });

        expect(plainClient.post).not.toHaveBeenCalled();
        expect(notice(response)).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
      });
    });

    describe("오류 처리", () => {
      it("카카오 설정이 없으면 1.6을 부르지 않고 연결 실패 문구를 남긴다", async () => {
        vi.stubEnv("KAKAO_CLIENT_ID", "");

        const response = await login();

        expect(plainClient.post).not.toHaveBeenCalled();
        expect(notice(response)).toEqual({ target: "login", text: SOCIAL_LOGIN_UNAVAILABLE });
      });

      // 예시 데이터: Swagger 1.6 400 · 409 · 503 예시 detail
      it.each([
        {
          code: "SOCIAL_EMAIL_REQUIRED",
          status: 400,
          detail: "이메일 제공에 동의해야 가입할 수 있어요.",
        },
        {
          code: "SOCIAL_EMAIL_DUPLICATED",
          status: 409,
          detail: "이미 가입한 이메일이에요. 처음 가입한 방법으로 로그인해 주세요.",
        },
        {
          code: "SOCIAL_LOGIN_UNAVAILABLE",
          status: 503,
          detail: "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
        },
      ])("고칠 수 있는 오류('$code')면 서버 문구를 남긴다", async ({ code, status, detail }) => {
        plainClient.post.mockRejectedValue(problem({ status, code, detail }));

        const response = await login();

        expect(response.headers.get("location")).toBe("/login");
        expect(notice(response)).toEqual({ target: "login", text: detail });
      });

      it.each([
        { code: "SOCIAL_LOGIN_FAILED", status: 401 },
        { code: "VALIDATION_FAILED", status: 400 },
      ])("고칠 수 없는 오류('$code')면 정해 둔 실패 문구를 남긴다", async ({ code, status }) => {
        plainClient.post.mockRejectedValue(problem({ status, code, detail: "서버가 준 문구" }));

        const response = await login();

        expect(notice(response)).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
      });

      it("보여 줄 코드여도 서버 문구가 비어 있으면 정해 둔 실패 문구를 남긴다", async () => {
        plainClient.post.mockRejectedValue(
          problem({ status: 400, code: "SOCIAL_EMAIL_REQUIRED", detail: "" }),
        );

        const response = await login();

        expect(notice(response)).toEqual({ target: "login", text: SOCIAL_LOGIN_FAILED });
      });

      it("서버에 닿지 못하면 다시 시도 안내를 남긴다", async () => {
        plainClient.post.mockRejectedValue(axiosNoResponse());

        const response = await login();

        expect(notice(response)).toEqual({ target: "login", text: RETRY_LATER });
      });
    });

    describe("권한 · 로그인", () => {
      it("그 사이 다른 탭에서 로그인했으면 1.6을 부르지 않고 지금 세션 그대로 홈으로 보낸다", async () => {
        const response = await login({ [ACCESS_TOKEN_COOKIE]: "access-now" });

        expect(plainClient.post).not.toHaveBeenCalled();
        expect(response.headers.get("location")).toBe("/home");
        expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
      });
    });
  });

  describe("연습 알림 켜기", () => {
    describe("정상 처리", () => {
      it("켜지면 문구 없이 설정 화면으로 돌아간다", async () => {
        plainClient.put.mockResolvedValue({ status: 200 });

        const response = await alarm();

        expect(response.headers.get("location")).toBe("/mypage/settings");
        expect(notice(response)).toBeNull();
      });
    });

    describe("오류 처리", () => {
      it("카카오 설정이 없으면 카카오 연결 실패 문구를 남긴다", async () => {
        vi.stubEnv("KAKAO_REDIRECT_URI", "");

        const response = await alarm();

        expect(plainClient.put).not.toHaveBeenCalled();
        expect(notice(response)).toEqual({ target: "settings", text: KAKAO_UNAVAILABLE });
      });

      // 예시 데이터: Swagger 2.9 400 · 409 · 503 예시 detail
      it.each([
        {
          code: "KAKAO_ACCOUNT_MISMATCH",
          status: 400,
          detail: "가입할 때 쓴 카카오 계정으로 동의해 주세요.",
        },
        {
          code: "KAKAO_MESSAGE_CONSENT_REQUIRED",
          status: 400,
          detail: "카카오톡 메시지 전송에 동의해야 알림을 받을 수 있어요.",
        },
        {
          code: "PRACTICE_ALARM_UNAVAILABLE",
          status: 409,
          detail: "카카오 계정을 연결한 회원만 연습 알림을 받을 수 있어요.",
        },
        {
          code: "KAKAO_UNAVAILABLE",
          status: 503,
          detail: "카카오 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
        },
      ])("고칠 수 있는 오류('$code')면 서버 문구를 남긴다", async ({ code, status, detail }) => {
        plainClient.put.mockRejectedValue(problem({ status, code, detail }));

        const response = await alarm();

        expect(response.headers.get("location")).toBe("/mypage/settings");
        expect(notice(response)).toEqual({ target: "settings", text: detail });
      });

      it.each([{ code: "KAKAO_CONSENT_FAILED" }, { code: "VALIDATION_FAILED" }])(
        "고칠 수 없는 오류('$code')면 정해 둔 알림 실패 문구를 남긴다",
        async ({ code }) => {
          plainClient.put.mockRejectedValue(
            problem({ status: 400, code, detail: "서버가 준 문구" }),
          );

          const response = await alarm();

          expect(notice(response)).toEqual({ target: "settings", text: KAKAO_CONSENT_FAILED });
        },
      );
    });

    describe("권한 · 로그인", () => {
      it.each([{ code: "TOKEN_EXPIRED" }, { code: "UNAUTHORIZED" }])(
        "401 '$code'면 문구 없이 설정 화면으로 보내고 토큰 쿠키는 건드리지 않는다",
        async ({ code }) => {
          plainClient.put.mockRejectedValue(problem({ status: 401, code }));

          const response = await alarm();

          expect(response.headers.get("location")).toBe("/mypage/settings");
          expect(notice(response)).toBeNull();
          expect(response.cookies.get(ACCESS_TOKEN_COOKIE)).toBeUndefined();
          expect(response.cookies.get(REFRESH_TOKEN_COOKIE)).toBeUndefined();
        },
      );
    });
  });

  describe("계정 연결", () => {
    describe("정상 처리", () => {
      it("연결되면 설정 화면으로 돌아가 완료 표시를 남긴다", async () => {
        plainClient.put.mockResolvedValue({ status: 200 });

        const response = await link();

        expect(response.headers.get("location")).toBe("/mypage/settings");
        expect(notice(response)).toEqual({ target: "settings", linked: true });
      });
    });

    describe("오류 처리", () => {
      // 예시 데이터: Swagger 2.12 409 · 503 예시 detail(400은 정해 둔 문구와 구분되게 바꾼 값)
      it.each([
        { code: "SOCIAL_LINK_FAILED", status: 400, detail: "서버가 준 연결 실패 문구" },
        { code: "SOCIAL_ALREADY_LINKED", status: 409, detail: "이미 연결한 소셜 계정이 있어요." },
        {
          code: "SOCIAL_ACCOUNT_IN_USE",
          status: 409,
          detail: "다른 회원이 쓰고 있는 카카오 계정이에요.",
        },
        {
          code: "SOCIAL_LOGIN_UNAVAILABLE",
          status: 503,
          detail: "소셜 로그인 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.",
        },
      ])("고칠 수 있는 오류('$code')면 서버 문구를 남긴다", async ({ code, status, detail }) => {
        plainClient.put.mockRejectedValue(problem({ status, code, detail }));

        const response = await link();

        expect(response.headers.get("location")).toBe("/mypage/settings");
        expect(notice(response)).toEqual({ target: "settings", text: detail });
      });

      it("고칠 수 없는 오류(VALIDATION_FAILED)면 정해 둔 연결 실패 문구를 남긴다", async () => {
        plainClient.put.mockRejectedValue(
          problem({ status: 400, code: "VALIDATION_FAILED", detail: "입력값을 확인해 주세요." }),
        );

        const response = await link();

        expect(notice(response)).toEqual({ target: "settings", text: SOCIAL_LINK_FAILED });
      });
    });

    describe("권한 · 로그인", () => {
      it.each([{ code: "TOKEN_EXPIRED" }, { code: "UNAUTHORIZED" }])(
        "401 '$code'면 문구 · 완료 표시 없이 설정 화면으로 보낸다",
        async ({ code }) => {
          plainClient.put.mockRejectedValue(problem({ status: 401, code }));

          const response = await link();

          expect(response.headers.get("location")).toBe("/mypage/settings");
          expect(notice(response)).toBeNull();
        },
      );
    });
  });
});
