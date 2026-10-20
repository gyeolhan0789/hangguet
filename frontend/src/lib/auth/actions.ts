"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { clearAuthCookies, REFRESH_TOKEN_COOKIE, setAuthCookies } from "@/lib/api/auth-cookies";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import {
  getProblemDetail,
  toFormActionResult,
  type FormActionResult,
} from "@/lib/api/problem-detail";
import { ROUTES } from "@/lib/routes";
import type { TokenResponse } from "@/types/api";

import {
  emailSchema,
  loginSchema,
  signupSchema,
  TERMS,
  TERMS_VERSION,
  type LoginValues,
  type SignupValues,
} from "./schemas";

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
  if (!parsed.success) return { formError: "이메일과 비밀번호를 확인해 주세요." };

  let data: TokenResponse;
  try {
    ({ data } = await api.post<TokenResponse>(endpoints.auth.login, parsed.data));
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
  try {
    const { data } = await api.post<TokenResponse>(endpoints.auth.signup, {
      nickname,
      email,
      password,
      agreements: TERMS.map(({ type }) => ({ termsType: type, termsVersion: TERMS_VERSION })),
    });
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
    const { data } = await api.get<{ available: boolean }>(endpoints.auth.emailAvailability, {
      params: { email: parsed.data },
    });
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
    try {
      await api.post(endpoints.auth.logout, { refreshToken });
    } catch {
      // 이미 폐기된 토큰이어도 204라서, 여기 오는 건 네트워크 오류뿐이다.
    }
  }
  clearAuthCookies(store);
  redirect(ROUTES.landing);
}
