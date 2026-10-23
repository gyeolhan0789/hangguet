"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import type { z } from "zod";

import { clearAuthCookies, setAccessTokenCookie } from "@/lib/api/auth-cookies";
import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import {
  getProblemDetail,
  RETRY_LATER,
  toFormActionResult,
  type FormActionResult,
} from "@/lib/api/problem-detail";
import { ROUTES } from "@/lib/routes";
import type {
  MeResponse,
  NicknameChangeResponse,
  NicknameRequest,
  PasswordChangeRequest,
  ProfileImageRequest,
  ProfileImageUploadUrlRequest,
  StreakFreezeUseRequest,
  StreakFreezeUseResponse,
  UploadUrlResponse,
  WithdrawRequest,
} from "@/types/api";

import {
  nicknameSchema,
  objectKeySchema,
  passwordChangeSchema,
  profileImageUploadSchema,
  withdrawSchema,
  type NicknameValues,
  type PasswordChangeValues,
  type ProfileImageUploadValues,
  type WithdrawValues,
} from "./schemas";

// 기준: 웹 Swagger 2.2 닉네임 변경(PATCH /users/me → 200 NicknameChangeResponse) · 2.3 비밀번호 변경(PATCH /users/me/password → 204
// · 400 PASSWORD_MISMATCH) · 2.4 프로필 사진 업로드 주소(POST …/profile-image/upload-url → 200 UploadUrlResponse)
// · 2.5 프로필 사진 등록(PUT …/profile-image → 200 MeResponse · 404 FILE_NOT_FOUND) · 2.6 프로필 사진 삭제(DELETE → 204)
// · 2.7 회원 탈퇴(POST /users/me → 204 · 400 PASSWORD_MISMATCH) · Figma S09-1 설정(18:3157) · 기획 메모 S09-1(18:1251)
// 바뀐 내 정보(2.1)는 헤더(C01) · 화면이 다시 불러오도록 refresh로 다시 그린다.

export interface UserActionResult<F extends string = never> extends FormActionResult<F> {
  ok?: true;
}

/** zod 검증 실패를 칸별 첫 오류로 바꾼다(폼과 같은 문구). */
function fieldErrorsOf<F extends string>(error: z.ZodError): Partial<Record<F, string>> {
  const errors: Partial<Record<F, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as F;
    errors[field] ??= issue.message;
  }
  return errors;
}

const NICKNAME_FIELDS = ["nickname"] as const;
const PASSWORD_FIELDS = ["currentPassword", "newPassword"] as const;
const WITHDRAW_FIELDS = ["password"] as const;

/** 2.2 닉네임 변경 */
export async function changeNickname(
  values: NicknameValues,
): Promise<UserActionResult<"nickname">> {
  const parsed = nicknameSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const body: NicknameRequest = parsed.data;
  let data: NicknameChangeResponse;
  try {
    ({ data } = await api.patch<NicknameChangeResponse>(endpoints.users.me, body));
  } catch (error) {
    unstable_rethrow(error);
    return toFormActionResult(error, NICKNAME_FIELDS);
  }
  // 토큰의 nickname이 바뀌도록 새 액세스 토큰을 준다. 리프레시 토큰은 그대로 쓴다(웹 Swagger 2.2).
  setAccessTokenCookie(await cookies(), data);
  refresh();
  return { ok: true };
}

/** 2.3 비밀번호 변경. 지금 비밀번호가 틀리면(PASSWORD_MISMATCH) 그 칸 아래에 알린다. */
export async function changePassword(
  values: PasswordChangeValues,
): Promise<UserActionResult<(typeof PASSWORD_FIELDS)[number]>> {
  const parsed = passwordChangeSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const body: PasswordChangeRequest = parsed.data;
  try {
    await api.patch(endpoints.users.password, body);
  } catch (error) {
    unstable_rethrow(error);
    const problem = getProblemDetail(error);
    if (problem?.code === "PASSWORD_MISMATCH") {
      return { fieldErrors: { currentPassword: problem.detail } };
    }
    return toFormActionResult(error, PASSWORD_FIELDS);
  }
  return { ok: true };
}

export interface UploadUrlResult extends FormActionResult<never> {
  upload?: UploadUrlResponse;
}

/** 2.4 프로필 사진 업로드 주소. 받은 uploadUrl로 브라우저가 S3에 직접 PUT한다(AGENTS.md 예외). */
export async function createProfileImageUploadUrl(
  values: ProfileImageUploadValues,
): Promise<UploadUrlResult> {
  const parsed = profileImageUploadSchema.safeParse(values);
  if (!parsed.success) return { formError: parsed.error.issues[0].message };

  const body: ProfileImageUploadUrlRequest = parsed.data;
  try {
    const { data } = await api.post<UploadUrlResponse>(endpoints.users.profileImageUploadUrl, body);
    return { upload: data };
  } catch (error) {
    unstable_rethrow(error);
    // 이 화면에는 칸이 없어, 칸 오류(VALIDATION_FAILED)도 첫 사유를 그대로 보여 준다.
    const problem = getProblemDetail(error);
    return { formError: problem?.errors?.[0]?.reason ?? problem?.detail ?? RETRY_LATER };
  }
}

/** 2.5 프로필 사진 등록. S3에 올린 뒤 objectKey로 등록한다. */
export async function registerProfileImage(objectKey: string): Promise<UserActionResult> {
  if (!objectKeySchema.safeParse(objectKey).success) return { formError: RETRY_LATER };

  const body: ProfileImageRequest = { objectKey };
  try {
    await api.put<MeResponse>(endpoints.users.profileImage, body);
  } catch (error) {
    unstable_rethrow(error);
    return toFormActionResult(error, []);
  }
  refresh();
  return { ok: true };
}

/** 2.6 프로필 사진 삭제 */
export async function deleteProfileImage(): Promise<UserActionResult> {
  try {
    await api.delete(endpoints.users.profileImage);
  } catch (error) {
    unstable_rethrow(error);
    return toFormActionResult(error, []);
  }
  refresh();
  return { ok: true };
}

/**
 * 2.7 회원 탈퇴 → 모든 토큰이 무효가 되므로(Swagger 2.7 "모든 토큰을 무효로 만든다") 쿠키를 지운다.
 * 이동할 곳은 명세에 없어, 1.5 로그아웃과 같이 로그인 전 첫 화면(S00 랜딩)으로 보낸다.
 * 비밀번호가 틀리면(PASSWORD_MISMATCH) 그 칸 아래에 알린다.
 */
export async function withdraw(
  values: WithdrawValues,
): Promise<UserActionResult<(typeof WITHDRAW_FIELDS)[number]>> {
  const parsed = withdrawSchema.safeParse(values);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  const body: WithdrawRequest = parsed.data;
  try {
    await api.post(endpoints.users.me, body);
  } catch (error) {
    unstable_rethrow(error);
    const problem = getProblemDetail(error);
    if (problem?.code === "PASSWORD_MISMATCH") return { fieldErrors: { password: problem.detail } };
    return toFormActionResult(error, WITHDRAW_FIELDS);
  }
  clearAuthCookies(await cookies());
  redirect(ROUTES.landing);
}

export interface StreakFreezeActionResult {
  /** 메운 결과(남은 개수 · 메운 뒤의 스트릭) */
  used?: StreakFreezeUseResponse;
  /** 서버 문구(404 STREAK_FREEZE_NOT_FOUND · 409 STREAK_FREEZE_NOT_AVAILABLE · 409 STREAK_FREEZE_DATE_NOT_ALLOWED) */
  error?: string;
}

/**
 * 8.14 유지권 사용 → 그 유지권의 메울 수 있는 날짜가 연습한 날로 들어간다. 기준: 기획 메모 S09-2([메우기] → 8.14 → S09-3,
 * 실패는 서버 문구) · StreakFreezeUseRequest · StreakFreezeUseResponse. 스트릭 · 달력 · 유지권 박스가 바뀌도록 refresh로 다시 그린다.
 */
export async function applyStreakFreeze(freezeId: number): Promise<StreakFreezeActionResult> {
  if (!Number.isSafeInteger(freezeId) || freezeId < 1) return { error: RETRY_LATER };

  const body: StreakFreezeUseRequest = { freezeId };
  let data: StreakFreezeUseResponse;
  try {
    ({ data } = await api.post<StreakFreezeUseResponse>(endpoints.streakFreezes.use, body));
  } catch (error) {
    unstable_rethrow(error);
    const problem = getProblemDetail(error);
    // 서버가 거절했으면(이미 썼거나 만료 · 없음 · 이미 연습한 날) 박스가 서버 상태와 같아지도록 다시 그린다
    if (problem) refresh();
    return { error: problem?.detail ?? RETRY_LATER };
  }
  refresh();
  return { used: data };
}
