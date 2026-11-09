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
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  SignupRequest,
  TokenResponse,
} from "@/types/api";

import {
  emailSchema,
  forgotPasswordSchema,
  loginSchema,
  passwordResetSchema,
  signupSchema,
  TERMS,
  type ForgotPasswordValues,
  type LoginValues,
  type PasswordResetValues,
  type SignupValues,
} from "./schemas";

// 1.1~1.3 · 1.8 · 1.9는 토큰 없이 부르는 API다(웹 Swagger security: []). 쿠키의 토큰을 붙이고 401이면 화면을 옮기는
// `api` 대신 `plainClient`로 보낸다.

/** 로그인 · 회원가입 폼에 칸이 있어 오류를 칸 아래에 보여 줄 수 있는 요청 필드 */
const LOGIN_FIELDS = ["email", "password"] as const;
const SIGNUP_FIELDS = ["nickname", "email", "password"] as const;

type AuthField = (typeof SIGNUP_FIELDS)[number];

export interface AuthActionResult extends FormActionResult<AuthField> {
  ok?: true;
}

/**
 * 1.3 429 LOGIN_LOCKED 문구. 서버 문구("잠시 후")에 남은 시간(retryAfterSeconds)을 분으로 올려 넣는다.
 * 남은 시간이 없으면 서버 문구를 그대로 쓴다.
 */
function lockedMessage(detail: string | undefined, retryAfterSeconds?: number): string {
  const fallback = detail ?? "로그인에 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.";
  if (!retryAfterSeconds || retryAfterSeconds <= 0) return fallback;
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `로그인에 여러 번 실패했어요. ${minutes}분 뒤에 다시 시도해 주세요.`;
}

/** 공통 변환에 회원가입의 EMAIL_DUPLICATED(이메일 칸 오류) · 로그인 잠김(남은 시간 안내)만 더한다. */
function toActionResult(error: unknown, formFields: readonly AuthField[]): AuthActionResult {
  const problem = getProblemDetail(error);
  if (problem?.code === "EMAIL_DUPLICATED") return { fieldErrors: { email: problem.detail } };
  if (problem?.code === "LOGIN_LOCKED") {
    return { formError: lockedMessage(problem.detail, problem.retryAfterSeconds) };
  }
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
    agreements: TERMS.map(({ type, version }) => ({ termsType: type, termsVersion: version })),
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

/**
 * 1.8 비밀번호 찾기 메일 요청. 서버는 가입 여부를 드러내지 않도록 결과와 관계없이 204를 준다.
 * 그래서 성공하면 화면은 "가입한 이메일이면 메일을 보냈어요"처럼 안내한다.
 */
export async function requestPasswordReset(
  values: ForgotPasswordValues,
): Promise<FormActionResult<"email"> & { ok?: true }> {
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) return { formError: "이메일을 확인해 주세요." };

  const body: PasswordResetRequest = { email: parsed.data.email };
  try {
    await plainClient.post(endpoints.auth.passwordReset, body);
    return { ok: true };
  } catch (error) {
    return toFormActionResult(error, ["email"]);
  }
}

export interface PasswordResetActionResult extends FormActionResult<"newPassword"> {
  ok?: true;
  /** 링크가 없거나 만료됐거나 이미 쓴 경우(400 PASSWORD_RESET_TOKEN_INVALID). 화면은 메일을 다시 받게 안내한다 */
  linkInvalid?: true;
}

/** 1.9 비밀번호 재설정. 모든 기기가 로그아웃되므로 화면은 새 비밀번호로 로그인하게 한다. */
export async function resetPassword(
  token: string,
  values: PasswordResetValues,
): Promise<PasswordResetActionResult> {
  const parsed = passwordResetSchema.safeParse(values);
  if (!parsed.success) return { formError: "입력값을 확인해 주세요." };

  const body: PasswordResetConfirmRequest = { token, newPassword: parsed.data.password };
  try {
    await plainClient.post(endpoints.auth.passwordResetConfirm, body);
  } catch (error) {
    const problem = getProblemDetail(error);
    // 링크의 token이 잘리거나 바뀌어 형식 검사(VALIDATION_FAILED token)에 걸려도 사용자가 고칠 수 없으니 링크 무효로 본다.
    const tokenRejected =
      problem?.code === "VALIDATION_FAILED" &&
      problem.errors?.some(({ field }) => field === "token");
    if (problem?.code === "PASSWORD_RESET_TOKEN_INVALID" || tokenRejected) {
      return {
        linkInvalid: true,
        ...(problem?.code === "PASSWORD_RESET_TOKEN_INVALID" && { formError: problem.detail }),
      };
    }
    return toFormActionResult(error, ["newPassword"]);
  }
  // 모든 기기가 로그아웃됐으니 이 브라우저에 남은 토큰도 지운다(로그인한 채 링크를 연 경우).
  clearAuthCookies(await cookies());
  return { ok: true };
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
