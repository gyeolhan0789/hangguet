import { http, HttpResponse, type MswFixture } from "next/experimental/testmode/playwright/msw";

import type { SessionCreateRequest } from "../../src/types/api";

import { API_BASE_URL } from "../../src/lib/api/config";

import {
  ANSWER,
  APPLICATION,
  AUTH_TOKENS,
  GROWTH_REVIEW,
  HOME,
  ME,
  NICKNAME_CHANGED,
  NOTICES_EMPTY,
  PRACTICE_LOGS,
  PROBLEM,
  QUESTION_CURRENT,
  REFRESHED_TOKENS,
  REPLAY,
  RESULT,
  SESSION,
  SESSION_CALENDAR,
  SESSION_ENDED,
  SESSION_LIST,
  SESSION_PLAN,
  SESSION_STARTED,
  STATS,
  STREAK_FREEZE_USED,
  STREAK_FREEZES,
  UPLOAD_URL,
} from "./data";

/** 웹 Swagger 경로(`/api/v1` 뒤) → 앱이 실제로 부르는 주소 */
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
 * 기본 핸들러: 앱이 부르는 API가 웹 Swagger의 정상 예시로 답한다(오늘 미완료 홈 · 7일 스트릭).
 * 화상 답변(5.6 · 5.10) · 질문 음성(5.12) · 리액션(5.11)은 아직 화면에 연결하지 않아 두지 않는다.
 * 시나리오마다 테스트에서 msw.use(...)로 필요한 응답만 덮어쓴다(요청이 나가기 전에 설정).
 */
export const defaultHandlers = [
  http.post(api("/auth/login"), () => HttpResponse.json(AUTH_TOKENS)),
  http.post(api("/auth/signup"), () => HttpResponse.json(AUTH_TOKENS, { status: 201 })),
  http.get(api("/auth/email-availability"), () => HttpResponse.json({ available: true })),
  http.post(api("/auth/token/refresh"), () => HttpResponse.json(REFRESHED_TOKENS)),
  http.post(api("/auth/logout"), () => new HttpResponse(null, { status: 204 })),
  http.get(api("/users/me"), () => HttpResponse.json(ME)),
  http.patch(api("/users/me"), () => HttpResponse.json(NICKNAME_CHANGED)),
  http.patch(api("/users/me/password"), () => new HttpResponse(null, { status: 204 })),
  http.post(api("/users/me/profile-image/upload-url"), () => HttpResponse.json(UPLOAD_URL)),
  http.put(api("/users/me/profile-image"), () => HttpResponse.json(ME)),
  http.delete(api("/users/me/profile-image"), () => new HttpResponse(null, { status: 204 })),
  http.post(api("/users/me"), () => new HttpResponse(null, { status: 204 })),
  http.get(api("/users/me/stats"), () => HttpResponse.json(STATS)),
  http.get(api("/practice-logs"), () => HttpResponse.json(PRACTICE_LOGS)),
  http.get(api("/home"), () => HttpResponse.json(HOME.NOT_DONE_TODAY)),
  http.get(api("/notices"), () => HttpResponse.json(NOTICES_EMPTY)),
  http.post(api("/notices/:noticeId/read"), () => new HttpResponse(null, { status: 204 })),
  http.get(api("/users/me/streak-freezes"), () => HttpResponse.json(STREAK_FREEZES)),
  http.post(api("/users/me/streak-freezes/use"), () => HttpResponse.json(STREAK_FREEZE_USED)),
  http.post(api("/applications"), () => HttpResponse.json(APPLICATION, { status: 201 })),
  http.get(api("/applications/:applicationId"), () => HttpResponse.json(APPLICATION)),
  http.patch(api("/applications/:applicationId"), () => HttpResponse.json(APPLICATION)),
  // 5.1은 Idempotency-Key(UUID)가 필수다. 없으면 mock 서버처럼 400으로 거절해, 모든 E2E가 헤더를 지키게 한다.
  http.post(api("/interview-sessions"), ({ request }) =>
    request.headers.get("Idempotency-Key")
      ? HttpResponse.json(SESSION, { status: 201 })
      : problemResponse(PROBLEM.VALIDATION_FAILED_IDEMPOTENCY_KEY),
  ),
  // 5.13 연습 면접 목록: 기본은 Swagger '기록 없는 날짜' 예시
  http.get(api("/interview-sessions"), () => HttpResponse.json(SESSION_LIST.EMPTY)),
  // 5.15 월별 연습 면접 횟수. 고정 경로라 /interview-sessions/:sessionId보다 먼저 둔다.
  http.get(api("/interview-sessions/calendar"), () => HttpResponse.json(SESSION_CALENDAR)),
  http.get(api("/interview-sessions/:sessionId"), () => HttpResponse.json(SESSION_PLAN.GENERATING)),
  http.get(api("/interview-sessions/:sessionId/questions/current"), () =>
    HttpResponse.json(QUESTION_CURRENT),
  ),
  http.post(api("/interview-sessions/:sessionId/plan/retry"), () =>
    HttpResponse.json({ ...SESSION_PLAN.GENERATING, planProgress: 0 }, { status: 202 }),
  ),
  // 5.4도 Idempotency-Key가 필수다.
  http.post(api("/interview-sessions/:sessionId/start"), ({ request }) =>
    request.headers.get("Idempotency-Key")
      ? HttpResponse.json(SESSION_STARTED)
      : problemResponse(PROBLEM.VALIDATION_FAILED_IDEMPOTENCY_KEY),
  ),
  // 5.7 답변 제출 202(채팅 TEXT로 바꾼 예시) · 5.8 면접 끝내기 202 'S06-E 답변한 2개까지 → S06-1'
  http.post(api("/interview-sessions/:sessionId/questions/:questionId/answer"), () =>
    HttpResponse.json(ANSWER, { status: 202 }),
  ),
  http.post(api("/interview-sessions/:sessionId/end"), () =>
    HttpResponse.json(SESSION_ENDED.ANALYZING, { status: 202 }),
  ),
  // 6.3 면접 결과 · 6.4 다시보기 · 7.1 날짜별 성장 리뷰 200 예시
  http.get(api("/interview-sessions/:sessionId/result"), () => HttpResponse.json(RESULT)),
  http.get(api("/interview-sessions/:sessionId/replay"), () => HttpResponse.json(REPLAY)),
  http.get(api("/growth-reviews/:practiceDate"), () => HttpResponse.json(GROWTH_REVIEW.S08)),
];

/** 5.1 요청을 모아 둔다: 본문과 Idempotency-Key 헤더. respond가 없으면 고른 방식으로 만든 면접(201)을 돌려준다. */
export function recordSessions(
  msw: MswFixture,
  respond?: (body: SessionCreateRequest) => Response,
) {
  const requests: { body: SessionCreateRequest; key: string | null }[] = [];
  msw.use(
    http.post(api("/interview-sessions"), async ({ request }) => {
      const body = (await request.json()) as SessionCreateRequest;
      requests.push({ body, key: request.headers.get("Idempotency-Key") });
      return respond?.(body) ?? HttpResponse.json({ ...SESSION, mode: body.mode }, { status: 201 });
    }),
  );
  return requests;
}
