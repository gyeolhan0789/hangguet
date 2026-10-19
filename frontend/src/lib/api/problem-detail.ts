import { isAxiosError } from "axios";

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
