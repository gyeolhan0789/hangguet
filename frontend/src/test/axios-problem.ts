import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";

import type { ProblemDetail } from "@/types/api";

/** 단위 테스트용: API가 ProblemDetail로 실패했을 때 axios가 던지는 오류를 만든다. */
export function axiosProblem(body: ProblemDetail) {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { status: body.status, data: body, headers: {}, config } as AxiosResponse;
  return new AxiosError("fail", undefined, config, null, response);
}

/** 단위 테스트용: 본문이 ProblemDetail이 아닌 응답(Nginx가 직접 주는 502 · 504 등)으로 실패했을 때 axios가 던지는 오류를 만든다. */
export function axiosStatusOnly(status: number, data: unknown = "") {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response = { status, data, headers: {}, config } as AxiosResponse;
  return new AxiosError("fail", undefined, config, null, response);
}

/** 단위 테스트용: 응답 없이 실패했을 때(연결 거부 · 시간 초과) axios가 던지는 오류를 만든다. */
export function axiosNoResponse(code: string = AxiosError.ECONNABORTED) {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError("fail", code, config, {});
}
