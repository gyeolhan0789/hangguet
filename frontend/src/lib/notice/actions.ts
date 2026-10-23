"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail, RETRY_LATER } from "@/lib/api/problem-detail";

// 기준: Swagger 8.9 공지 확인(POST /notices/{noticeId}/read → 204, 이미 확인했어도 204 · 404 NOTICE_NOT_FOUND)
// · 기획 메모 C02([확인] → 8.9 → 다음 확인 안 한 공지) · C03(확인하면 목록에서 확인함으로)
// 확인한 공지가 목록 · 종 점에서 바뀌도록 refresh로 다시 그린다.

export interface NoticeReadResult {
  ok?: true;
  error?: string;
}

/** 8.9 공지 확인 */
export async function readNotice(noticeId: number): Promise<NoticeReadResult> {
  if (!Number.isSafeInteger(noticeId) || noticeId < 1) return { error: RETRY_LATER };
  try {
    await api.post(endpoints.notices.read(noticeId));
  } catch (error) {
    unstable_rethrow(error);
    return { error: getProblemDetail(error)?.detail ?? RETRY_LATER };
  }
  refresh();
  return { ok: true };
}
