import type { Page } from "@playwright/test";
import { http, HttpResponse, type MswFixture } from "next/experimental/testmode/playwright/msw";

import type { RoomResponse } from "../../src/types/api";

import { API_BASE_URL } from "../../src/lib/api/config";

import {
  ANSWER,
  APPLICATION,
  APPLICATION_LIST,
  APPLICATION_NO_SESSIONS,
  AUTH_TOKENS,
  COMPANIES,
  GROWTH_REVIEW,
  HOME,
  ME,
  NICKNAME_CHANGED,
  NOTICES_EMPTY,
  PRACTICE_LOGS,
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
  PRACTICE_ALARM_UNAVAILABLE,
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
  http.get(api("/users/me/practice-alarm"), () => HttpResponse.json(PRACTICE_ALARM_UNAVAILABLE)),
  http.get(api("/users/me/stats"), () => HttpResponse.json(STATS)),
  http.get(api("/practice-logs"), () => HttpResponse.json(PRACTICE_LOGS)),
  http.get(api("/home"), () => HttpResponse.json(HOME.NOT_DONE_TODAY)),
  http.get(api("/notices"), () => HttpResponse.json(NOTICES_EMPTY)),
  http.post(api("/notices/:noticeId/read"), () => new HttpResponse(null, { status: 204 })),
  http.get(api("/users/me/streak-freezes"), () => HttpResponse.json(STREAK_FREEZES)),
  http.post(api("/users/me/streak-freezes/use"), () => HttpResponse.json(STREAK_FREEZE_USED)),
  http.post(api("/applications"), () => HttpResponse.json(APPLICATION, { status: 201 })),
  http.get(api("/applications"), () => HttpResponse.json(APPLICATION_LIST)),
  http.get(api("/applications/:applicationId"), () => HttpResponse.json(APPLICATION)),
  http.get(api("/applications/:applicationId/interview-sessions"), () =>
    HttpResponse.json(APPLICATION_NO_SESSIONS),
  ),
  http.delete(api("/applications/:applicationId"), () => new HttpResponse(null, { status: 204 })),
  http.get(api("/companies"), () => HttpResponse.json(COMPANIES)),
  http.post(api("/interview-sessions"), () => HttpResponse.json(SESSION, { status: 201 })),
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
  http.post(api("/interview-sessions/:sessionId/start"), () => HttpResponse.json(SESSION_STARTED)),
  // 면접방에 실제로 붙는 E2E는 없다(실제 연결 확인은 E2E 밖). 연결 중으로 둘 때는 roomStaysConnecting을 쓴다.
  http.post(api("/interview-sessions/:sessionId/room-token"), () =>
    problemResponse({
      title: "Conflict",
      status: 409,
      code: "INVALID_SESSION_STATE",
      detail: "지금은 할 수 없는 요청이에요.",
    }),
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

/** 3.1 홈을 '오늘 연습 완료'(Swagger 예시 S02-B)로 답한다. 인트로 없이 홈을 지나야 하는, 홈 상태와 상관없는 spec이 msw.use로 건다 */
export const homeDoneToday = http.get(api("/home"), () => HttpResponse.json(HOME.DONE_TODAY));

/** roomStaysConnecting이 주는 면접방 주소의 호스트. 실제로 나가지 않고 page.routeWebSocket이 받는다 */
const CONNECTING_ROOM_HOST = "rtc.e2e.test";

/** 5.14 면접방 입장 200 — 웹 Swagger 예시에서 주소 · 토큰만 테스트 값으로 바꿨다 */
const CONNECTING_ROOM = {
  url: `wss://${CONNECTING_ROOM_HOST}`,
  token: "e2e-room-token",
  expiresAt: "2026-10-15T12:18:42+09:00",
} satisfies RoomResponse;

/**
 * 화상 면접방을 '연결 중'에 머물게 한다. 5.14는 200으로 답해 서버 액션을 붙잡지 않고(뒤 5.8 [끝내기]가 막히지 않는다),
 * LiveKit 신호 소켓(wss://rtc.e2e.test/rtc/v1?…)은 열리지 않은 채 남아 '잠시 멈춤' 카드가 뜨지 않는다.
 * 뒤에 서버 액션이 있는 화상 test에서 page.goto 전에 부른다(뒤에 서버 액션이 없으면 spec의 5.14 무응답 대역으로 충분하다).
 * 한계: LiveKit 신호 연결 제한 시간(15초, setTimeout)은 시계가 흐르는 동안 줄어든다. 시계를 흐르게 둔 시간이 15초를 넘으면 실패한다.
 */
export async function roomStaysConnecting(page: Page, msw: MswFixture) {
  msw.use(
    http.post(api("/interview-sessions/:sessionId/room-token"), () =>
      HttpResponse.json(CONNECTING_ROOM),
    ),
  );
  // 핸들러가 끝나야 Playwright가 소켓을 '열림'으로 만든다. 끝나지 않게 두어 업그레이드 대기(CONNECTING)에 머물게 한다.
  await page.routeWebSocket(
    (url) => url.hostname === CONNECTING_ROOM_HOST,
    () => new Promise<never>(() => {}),
  );
}
