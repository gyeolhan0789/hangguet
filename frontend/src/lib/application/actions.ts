"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { toFormActionResult, type FormActionResult } from "@/lib/api/problem-detail";
import { interviewerPath } from "@/lib/routes";
import type { ApplicationCreateRequest, ApplicationResponse } from "@/types/api";

import { APPLICATION_FIELDS, applicationSchema, type ApplicationValues } from "./schemas";

// 기준: Swagger 4.1 지원서 작성(POST /applications → 201 ApplicationResponse) · 공통 실패 응답 ProblemDetail
// · Figma S03 [다음: 면접관 선택] → S04

export type ApplicationActionResult = FormActionResult<keyof ApplicationValues>;

/** 4.1 지원서 작성 → 만든 지원서를 들고 S04 면접관 선택으로 간다. */
export async function createApplication(
  values: ApplicationValues,
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
  redirect(interviewerPath(data.id));
}
