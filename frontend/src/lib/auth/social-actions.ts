"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { setAuthCookies } from "@/lib/api/auth-cookies";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail, RETRY_LATER } from "@/lib/api/problem-detail";
import { plainClient } from "@/lib/api/token-refresh";
import { ROUTES } from "@/lib/routes";
import type { ErrorCode, SocialSignupRequest, TokenResponse } from "@/types/api";

import {
  authorizeUrl,
  clearNotice,
  clearSignupToken,
  issueState,
  kakaoConfig,
  saveNotice,
  SOCIAL_LOGIN_FAILED,
  SIGNUP_TOKEN_INVALID,
  SOCIAL_LOGIN_UNAVAILABLE,
  SOCIAL_SIGNUP_COOKIE,
} from "./kakao";
import { socialSignupSchema, TERMS, TERMS_VERSION, type SocialSignupValues } from "./schemas";

// 기준: 웹 Swagger 1.7 소셜 회원가입(SocialSignupRequest: signupToken · agreements 3개 → 201 TokenResponse · 400 AGREEMENT_REQUIRED
// · 401 SIGNUP_TOKEN_INVALID · 409 SOCIAL_EMAIL_DUPLICATED) · 기획 메모 S01-3(423:2140: [카카오 로그인] → 카카오 동의 화면
// → 콜백, 처음 온 사람은 S01 위 약관 동의 모달 → 1.7 → 자동 로그인 → S02-D, 오류는 모달을 닫고 S01 오류 문구 자리에 —
// 고칠 수 있는 오류는 서버 detail, 고칠 수 없는 오류는 SOCIAL_LOGIN_FAILED 문구, ✕로 닫으면 가입 토큰 삭제)
// 1.6은 카카오가 콜백 주소로 돌려보낸 뒤 Route Handler(app/oauth/kakao/callback)가 부른다.

/** 사용자가 고칠 수 있어 서버 문구(detail)를 그대로 보여 주는 1.7 오류 */
const SIGNUP_SHOWN_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "SIGNUP_TOKEN_INVALID",
  "SOCIAL_EMAIL_DUPLICATED",
]);

/** S01 [카카오 로그인] · S01-1 [카카오로 시작하기] → state를 저장하고 카카오 인가 화면으로 보낸다. */
export async function startKakaoLogin(): Promise<void> {
  const store = await cookies();
  // 닫지 않고 떠난 예전 가입 모달이 새 로그인 · 실패 문구와 같이 뜨지 않게 먼저 지운다
  clearSignupToken(store);
  const config = kakaoConfig();
  if (!config) {
    saveNotice(store, { target: "login", text: SOCIAL_LOGIN_UNAVAILABLE });
    redirect(ROUTES.login);
  }
  const state = issueState(store, "login");
  redirect(authorizeUrl(config, state, "login"));
}

/**
 * 1.7 소셜 회원가입 → 로그인 토큰을 쿠키에 저장하고 홈(S02-D 첫 방문)으로 보낸다. 가입 토큰은 쿠키에서만 읽는다.
 * 실패하면 가입 토큰을 지우고 S01로 돌아가 문구를 보인다(다시 하려면 카카오 로그인부터).
 */
export async function socialSignup(values: SocialSignupValues): Promise<void> {
  const store = await cookies();
  // 화면은 모두 동의해야 버튼을 연다. 그래도 동의가 빠졌으면(화면을 거치지 않은 요청) 1.7을 부르지 않는다.
  const agreed = socialSignupSchema.safeParse(values).success;
  const signupToken = agreed ? store.get(SOCIAL_SIGNUP_COOKIE)?.value : undefined;
  // 가입 토큰 쿠키가 없으면 유효 시간(signup.expiresIn)이 지나 사라진 것이다: 1.7의 401과 같은 문구로 다시 로그인하게 한다.
  let notice = agreed ? SIGNUP_TOKEN_INVALID : SOCIAL_LOGIN_FAILED;
  let tokens: TokenResponse | undefined;
  if (signupToken) {
    notice = SOCIAL_LOGIN_FAILED;
    const body: SocialSignupRequest = {
      signupToken,
      agreements: TERMS.map(({ type }) => ({ termsType: type, termsVersion: TERMS_VERSION })),
    };
    try {
      ({ data: tokens } = await plainClient.post<TokenResponse>(endpoints.auth.socialSignup, body));
    } catch (error) {
      const problem = getProblemDetail(error);
      if (!problem) notice = RETRY_LATER;
      else if (problem.code && SIGNUP_SHOWN_CODES.has(problem.code) && problem.detail) {
        notice = problem.detail;
      }
    }
  }
  clearSignupToken(store);
  if (tokens) {
    setAuthCookies(store, tokens);
    redirect(ROUTES.home);
  }
  saveNotice(store, { target: "login", text: notice });
  redirect(ROUTES.login);
}

/** S01-3 ✕ → 가입하지 않는다. 가입 토큰을 지운다 */
export async function cancelSocialSignup(): Promise<void> {
  clearSignupToken(await cookies());
}

/** S01 · S09-1에 한 번 보여 준 문구를 지운다(새로 고쳐도 다시 뜨지 않게) */
export async function dismissNotice(): Promise<void> {
  clearNotice(await cookies());
}
