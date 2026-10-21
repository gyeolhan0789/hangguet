import { isAxiosError } from "axios";

import { RETRY_LATER } from "@/lib/messages";
import type { ProblemDetail } from "@/types/api";

function isProblemDetail(data: unknown): data is ProblemDetail {
  return typeof data === "object" && data !== null && "code" in data && "status" in data;
}

/** axios 오류에서 ProblemDetail을 꺼낸다. 네트워크 오류 등 형식이 다르면 null. */
export function getProblemDetail(error: unknown): ProblemDetail | null {
  if (!isAxiosError(error)) return null;
  const data: unknown = error.response?.data;
  return isProblemDetail(data) ? data : null;
}

/**
 * axios 오류에서 HTTP 상태 코드를 꺼낸다. Nginx가 직접 주는 502 · 504처럼 본문이 ProblemDetail이 아니어도 상태는 있다(API 명세 1장).
 * 응답이 아예 없는 오류(연결 거부 · 시간 초과)와 axios 오류가 아닌 값은 null.
 */
export function getHttpStatus(error: unknown): number | null {
  if (!isAxiosError(error)) return null;
  return error.response?.status ?? null;
}

/** 서버 액션이 폼에 돌려주는 실패 결과. F는 그 폼의 칸 이름 */
export interface FormActionResult<F extends string = string> {
  /** 폼 전체에 보여 줄 오류(서버 오류 · 폼에 칸이 없는 오류 등) */
  formError?: string;
  /** 칸별 오류(VALIDATION_FAILED 등) */
  fieldErrors?: Partial<Record<F, string>>;
}

export { RETRY_LATER };

/**
 * API 실패를 폼에 보여 줄 형태로 바꾼다. formFields는 그 폼에 있는 칸 이름이다.
 * VALIDATION_FAILED에서 폼에 없는 칸의 오류(예: 1.2의 agreements)는 칸 아래에 보여 줄 수 없으므로
 * 폼 아래 문구(detail)로 알린다. 그 밖의 실패는 서버 문구(detail)를 그대로 쓴다.
 */
export function toFormActionResult<F extends string>(
  error: unknown,
  formFields: readonly F[],
): FormActionResult<F> {
  const problem = getProblemDetail(error);
  if (!problem) return { formError: RETRY_LATER };
  if (problem.code === "VALIDATION_FAILED" && problem.errors?.length) {
    const onForm = problem.errors.filter(({ field }) => formFields.includes(field as F));
    return {
      ...(onForm.length > 0 && {
        fieldErrors: Object.fromEntries(
          onForm.map(({ field, reason }) => [field, reason]),
        ) as Partial<Record<F, string>>,
      }),
      ...(onForm.length < problem.errors.length && { formError: problem.detail }),
    };
  }
  return { formError: problem.detail };
}
