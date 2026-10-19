import { http, HttpResponse } from "next/experimental/testmode/playwright/msw";

import { API_BASE_URL } from "../../src/lib/api/config";

import { AUTH_TOKENS, HOME, ME, REFRESHED_TOKENS } from "./data";

/** API 명세 경로(`/api/v1` 뒤) → 앱이 실제로 부르는 주소 */
export const api = (path: string) => `${API_BASE_URL}${path}`;

/**
 * 실패 응답. mock 서버처럼 RFC 9457 형식의 Content-Type(application/problem+json)과 그 오류의 상태 코드로 답한다.
 */
export const problemResponse = <T extends { status: number }>(problem: T) =>
  HttpResponse.json(problem, {
    status: problem.status,
    headers: { "Content-Type": "application/problem+json" },
  });

/**
 * 기본 핸들러: 모든 API가 Swagger의 정상 예시로 답한다(오늘 미완료 홈 · 7일 스트릭).
 * 시나리오마다 테스트에서 msw.use(...)로 필요한 응답만 덮어쓴다(요청이 나가기 전에 설정).
 */
export const defaultHandlers = [
  http.post(api("/auth/login"), () => HttpResponse.json(AUTH_TOKENS)),
  http.post(api("/auth/signup"), () => HttpResponse.json(AUTH_TOKENS, { status: 201 })),
  http.get(api("/auth/email-availability"), () => HttpResponse.json({ available: true })),
  http.post(api("/auth/token/refresh"), () => HttpResponse.json(REFRESHED_TOKENS)),
  http.post(api("/auth/logout"), () => new HttpResponse(null, { status: 204 })),
  http.get(api("/users/me"), () => HttpResponse.json(ME)),
  http.get(api("/home"), () => HttpResponse.json(HOME.NOT_DONE_TODAY)),
];
