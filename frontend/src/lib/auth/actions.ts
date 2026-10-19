"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { clearAuthCookies, REFRESH_TOKEN_COOKIE, setAuthCookies } from "@/lib/api/auth-cookies";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail, type AuthResponse } from "@/lib/api/types";
import { ROUTES } from "@/lib/routes";

import {
  emailSchema,
  loginSchema,
  signupSchema,
  TERMS,
  TERMS_VERSION,
  type LoginValues,
  type SignupValues,
} from "./schemas";

export interface AuthActionResult {
  ok?: true;
  /** 폼 전체에 보여 줄 오류(예: LOGIN_FAILED) */
  formError?: string;
  /** 칸별 오류(VALIDATION_FAILED · EMAIL_DUPLICATED) */
  fieldErrors?: Record<string, string>;
}

const RETRY_LATER = "잠시 후 다시 시도해 주세요.";

function toActionResult(error: unknown): AuthActionResult {
  const problem = getProblemDetail(error);
  if (!problem) return { formError: RETRY_LATER };
  if (problem.code === "VALIDATION_FAILED" && problem.errors?.length) {
    return {
      fieldErrors: Object.fromEntries(problem.errors.map(({ field, reason }) => [field, reason])),
    };
  }
  if (problem.code === "EMAIL_DUPLICATED") return { fieldErrors: { email: problem.detail } };
  return { formError: problem.detail };
}

/** 1.3 로그인 → 토큰을 쿠키에 저장하고 홈(S02)으로 보낸다. */
export async function login(values: LoginValues): Promise<AuthActionResult> {
  const parsed = loginSchema.safeParse(values);
  if (!parsed.success) return { formError: "이메일과 비밀번호를 확인해 주세요." };

  let data: AuthResponse;
  try {
    ({ data } = await api.post<AuthResponse>(endpoints.auth.login, parsed.data));
  } catch (error) {
    return toActionResult(error);
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
    const { data } = await api.post<AuthResponse>(endpoints.auth.signup, {
      nickname,
      email,
      password,
      agreements: TERMS.map(({ type }) => ({ termsType: type, termsVersion: TERMS_VERSION })),
    });
    setAuthCookies(await cookies(), data);
    return { ok: true };
  } catch (error) {
    return toActionResult(error);
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
