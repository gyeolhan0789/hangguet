"use server";

import { refresh } from "next/cache";
import { redirect, RedirectType, unstable_rethrow } from "next/navigation";

import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import {
  getProblemDetail,
  RETRY_LATER,
  toFormActionResult,
  type FormActionResult,
} from "@/lib/api/problem-detail";
import {
  applicationPath,
  practiceSelectPath,
  ROUTES,
  type ApplicationWriteFrom,
} from "@/lib/routes";
import type { ApplicationCreateRequest, ApplicationResponse } from "@/types/api";

import { APPLICATION_FIELDS, applicationSchema, type ApplicationValues } from "./schemas";

// 기준: Swagger 4.1 지원서 작성(POST /applications → 201 ApplicationResponse · 400 VALIDATION_FAILED(coverLetterItems: 질문을
// 만들기 어려운 자기소개서) · 503 COVER_LETTER_CHECK_UNAVAILABLE) · 4.5 지원서 삭제(DELETE /applications/{applicationId} → 204
// · 404 APPLICATION_NOT_FOUND, 면접에 쓴 지원서도 지운다) · 공통 실패 응답 ProblemDetail
// · 사용자 결정(2026-10-29: 저장 뒤 들어온 곳으로 — 지원 관리면 새 지원서 상세, S03이면 새 지원서를 골라 둔 S03.
//   삭제에 실패하면 모달 안에 서버 문구, 성공이면 목록으로)
// · Next 16 refresh(서버 액션 전용): 응답에 x-action-revalidated를 실어 클라이언트가 BFCache를 비우게 한다
//   (server-action-reducer → invalidateBfCache). redirect만 하면 뒤로 가기가 저장 · 삭제 전의 4.3 목록(지원 관리 · S03)을 다시 보여 준다.

export type ApplicationActionResult = FormActionResult<keyof ApplicationValues>;

/** 4.1 지원서 작성 → 지원서 쓰기를 연 곳(from)으로 새 지원서를 들고 간다. */
export async function createApplication(
  values: ApplicationValues,
  from: ApplicationWriteFrom,
): Promise<ApplicationActionResult> {
  const parsed = applicationSchema.safeParse(values);
  if (!parsed.success) return { formError: "입력값을 확인해 주세요." };

  const body: ApplicationCreateRequest = parsed.data;
  let data: ApplicationResponse;
  try {
    ({ data } = await api.post<ApplicationResponse>(endpoints.applications.root, body));
  } catch (error) {
    // 401(TOKEN_EXPIRED · UNAUTHORIZED)이면 api가 재발급 · 로그아웃 화면으로 redirect한다. 그 신호는 Next가 처리하게 다시 던진다.
    unstable_rethrow(error);
    return toFormActionResult(error, APPLICATION_FIELDS);
  }
  // 뒤로 가기로 돌아간 지원 관리 목록 · S03이 새 지원서를 담은 4.3을 다시 받게 한다(redirect가 던지기 전에 불러야 한다).
  refresh();
  // 기록을 바꿔치기(replace)해, 뒤로 가기로 저장한 내용이 든 지원서 쓰기에 돌아가 같은 지원서를 또 만들지 않게 한다.
  redirect(
    from === "practice" ? practiceSelectPath(data.id, true) : applicationPath(data.id),
    RedirectType.replace,
  );
}

export interface DeleteApplicationResult {
  /** 모달 안에 보여 줄 서버 문구 */
  error?: string;
}

/** 4.5 지원서 삭제 → 지원 관리 목록으로. 이미 없는 지원서(404)도 목록으로 보낸다. */
export async function deleteApplication(applicationId: number): Promise<DeleteApplicationResult> {
  // 서버 액션 인자는 브라우저가 보내므로 id도 다시 검사한다(양의 정수).
  if (!Number.isSafeInteger(applicationId) || applicationId <= 0) {
    redirect(ROUTES.applications, RedirectType.replace);
  }
  try {
    await api.delete(endpoints.applications.detail(applicationId));
  } catch (error) {
    unstable_rethrow(error);
    const problem = getProblemDetail(error);
    if (problem?.code !== "APPLICATION_NOT_FOUND") return { error: problem?.detail ?? RETRY_LATER };
  }
  // 지운(이미 없는) 지원서가 BFCache에 남은 지원 관리 목록 · S03에 다시 보이지 않게 한다.
  refresh();
  // 뒤로 가기로 지운 지원서의 상세(Activity에 남은 화면)에 돌아가지 않게 기록을 바꿔치기한다.
  redirect(ROUTES.applications, RedirectType.replace);
}
