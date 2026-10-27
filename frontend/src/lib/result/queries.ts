import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import { getProblemDetail } from "@/lib/api/problem-detail";
import type { ReplayResponse, ResultResponse } from "@/types/api";

// 기준: 웹 Swagger 6.3 면접 결과 · 6.4 다시보기(200 · 404 SESSION_NOT_FOUND · 409 RESULT_NOT_READY · 409 NO_RESULT)
// · RESULT_NOT_READY면 S06-1 분석 중 화면으로

/** ok 결과가 있음 · analyzing 아직 분석 중이거나 분석 실패(S06-1로) · missing 면접이 없거나 결과가 없음 */
export type ResultLoad<T> = { status: "ok"; data: T } | { status: "analyzing" | "missing" };

async function load<T>(url: string): Promise<ResultLoad<T>> {
  try {
    const { data } = await api.get<T>(url);
    return { status: "ok", data };
  } catch (error) {
    const code = getProblemDetail(error)?.code;
    if (code === "RESULT_NOT_READY") return { status: "analyzing" };
    if (code === "SESSION_NOT_FOUND" || code === "NO_RESULT") return { status: "missing" };
    throw error;
  }
}

/** 6.3 면접 결과. 서버 컴포넌트에서만 부른다. */
export const getResult = (sessionId: number) =>
  load<ResultResponse>(endpoints.results.result(sessionId));

/** 6.4 다시보기. 서버 컴포넌트에서만 부른다. */
export const getReplay = (sessionId: number) =>
  load<ReplayResponse>(endpoints.results.replay(sessionId));
