import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

import type { ProblemDetail } from "@/types/api";

/** 단위 테스트용: API가 ProblemDetail로 실패했을 때 axios가 던지는 오류를 만든다. */
export function axiosProblem(body: ProblemDetail) {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { status: body.status, data: body, headers: {}, config } as AxiosResponse;
  return new AxiosError("fail", undefined, config, null, response);
}
