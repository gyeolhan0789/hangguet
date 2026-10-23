"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  ACCESS_TOKEN_COOKIE,
  clearAuthCookies,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from "@/lib/api/auth-cookies";
import { endpoints } from "@/lib/api/endpoints";
import {
  getProblemDetail,
  toFormActionResult,
  type FormActionResult,
} from "@/lib/api/problem-detail";
import { plainClient, refreshTokens } from "@/lib/api/token-refresh";
import { ROUTES } from "@/lib/routes";
import type {
  EmailAvailabilityQuery,
  EmailAvailabilityResponse,
  LoginRequest,
  LogoutRequest,
  SignupRequest,
  TokenResponse,
} from "@/types/api";

import {
  emailSchema,
  loginSchema,
  signupSchema,
  TERMS,
  TERMS_VERSION,
  type LoginValues,
  type SignupValues,
} from "./schemas";

// 1.1~1.3은 토큰 없이 부르는 API다(웹 Swagger security: []). 쿠키의 토큰을 붙이고 401이면 화면을 옮기는
// `api` 대신 `plainClient`로 보낸다.

/** 로그인 · 회원가입 폼에 칸이 있어 오류를 칸 아래에 보여 줄 수 있는 요청 필드 */
const LOGIN_FIELDS = ["email", "password"] as const;
const SIGNUP_FIELDS = ["nickname", "email", "password"] as const;

type AuthField = (typeof SIGNUP_FIELDS)[number];

export interface AuthActionResult extends FormActionResult<AuthField> {
  ok?: true;
}

/** 공통 변환에 회원가입의 EMAIL_DUPLICATED(이메일 칸 오류)만 더한다. */
function toActionResult(error: unknown, formFields: readonly AuthField[]): AuthActionResult {
  const problem = getProblemDetail(error);
  if (problem?.code === "EMAIL_DUPLICATED") return { fieldErrors: { email: problem.detail } };
  return toFormActionResult(error, formFields);
}

/** 1.3 로그인 → 토큰을 쿠키에 저장하고 홈(S02)으로 보낸다. */
export async function login(values: LoginValues): Promise<AuthActionResult> {
  const parsed = loginSchema.safeParse(values);
  if (!parsed.success) return { formError: "이메일 또는 비밀번호를 확인해 주세요." };

  const body: LoginRequest = parsed.data;
  let data: TokenResponse;
  try {
    ({ data } = await plainClient.post<TokenResponse>(endpoints.auth.login, body));
  } catch (error) {
    return toActionResult(error, LOGIN_FIELDS);
  }
  setAuthCookies(await cookies(), data);
  redirect(ROUTES.home);
}

/**
 * 1.2 회원가입 → 가입과 동시에 로그인 상태가 된다.
 * 화면이 완료 애니메이션을 보여 준 뒤 S02-D로 넘어가도록 이동은 클라이언트가 한다.
 */
export async function signup(values: SignupValues): Promise<AuthActionResult> {
  const parsed = signupSchema.safeParse(values);
  if (!parsed.success) return { formError: "입력값을 확인해 주세요." };

  const { nickname, email, password } = parsed.data;
  const body: SignupRequest = {
    nickname,
    email,
    password,
    agreements: TERMS.map(({ type }) => ({ termsType: type, termsVersion: TERMS_VERSION })),
  };
  try {
    const { data } = await plainClient.post<TokenResponse>(endpoints.auth.signup, body);
    setAuthCookies(await cookies(), data);
    return { ok: true };
  } catch (error) {
    return toActionResult(error, SIGNUP_FIELDS);
  }
}

/** 1.1 이메일 사용 가능 여부. 형식이 틀리거나 확인하지 못하면 null */
export async function checkEmailAvailable(email: string): Promise<boolean | null> {
  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return null;
  try {
    const params: EmailAvailabilityQuery = { email: parsed.data };
    const { data } = await plainClient.get<EmailAvailabilityResponse>(
      endpoints.auth.emailAvailability,
      { params },
    );
    return data.available;
  } catch {
    return null;
  }
}

/** 1.5 로그아웃 → 확인 없이 랜딩(S00)으로. 서버 폐기가 실패해도 쿠키는 지운다. */
export async function logout(): Promise<void> {
  const store = await cookies();
  const refreshToken = store.get(REFRESH_TOKEN_COOKIE)?.value;
  if (refreshToken) {
    await revokeRefreshToken(store.get(ACCESS_TOKEN_COOKIE)?.value, refreshToken).catch(() => {});
  }
  clearAuthCookies(store);
  redirect(ROUTES.landing);
}

// 기준: 웹 Swagger 1.5 로그아웃(Bearer · LogoutRequest · 204) · 공통 401 TOKEN_EXPIRED · 1.4 토큰 재발급.
// 401이면 화면을 옮기는 `api` 인터셉터 대신 직접 보낸다. 만료(TOKEN_EXPIRED)면 1.4로 새 토큰을 받아
// 새 토큰으로 다시 보낸다(보낸 리프레시 토큰은 1.4에서 폐기된다).
async function revokeRefreshToken(accessToken: string | undefined, refreshToken: string) {
  try {
    await sendLogout(accessToken, refreshToken);
  } catch (error) {
    if (getProblemDetail(error)?.code !== "TOKEN_EXPIRED") throw error;
    const renewed = await refreshTokens(refreshToken);
    if (renewed) await sendLogout(renewed.accessToken, renewed.refreshToken);
  }
}

function sendLogout(accessToken: string | undefined, refreshToken: string) {
  const body: LogoutRequest = { refreshToken };
  return plainClient.post(endpoints.auth.logout, body, {
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  });
}
