// mock 서버 Swagger(https://hangguet.yobistory.com/mock/be/docs)의 응답 예시를 그대로 옮긴 값.
// E2E는 이 값을 MSW 핸들러 응답으로 돌려준다. Swagger 예시가 바뀌면 같이 바꾼다.
// 단, 액세스 토큰 예시 "eyJ…"는 생략 표기(…)라 HTTP 헤더에 넣을 수 없어서, 같은 모양의 ASCII 값으로 바꿨다.
import type { ApplicationResponse, ProblemDetail } from "../../src/types/api";

const ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.e2e-access";
const REFRESHED_ACCESS_TOKEN = "eyJhbGciOiJIUzI1NiJ9.e2e-refreshed";

/** 1.3 로그인 · 1.2 회원가입 200/201 */
export const AUTH_TOKENS = {
  accessToken: ACCESS_TOKEN,
  refreshToken: "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10",
  expiresIn: 3600,
  user: { id: 1, email: "a@ssafy.com", nickname: "면접왕", profileImageUrl: null },
};

/** 1.4 토큰 재발급 200 */
export const REFRESHED_TOKENS = {
  accessToken: REFRESHED_ACCESS_TOKEN,
  refreshToken: "8f14e45f-ceea-4672-9f5a-2f1c7a3b9d10",
  expiresIn: 3600,
};

/** 2.1 내 정보 200 */
export const ME = {
  id: 1,
  email: "example@ssafy.com",
  nickname: "면접왕",
  profileImageUrl: "https://…",
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
};

/** 3.1 홈 200 — Swagger 예시 4개(S02 · S02-B · S02-C · S02-D) */
export const HOME = {
  NOT_DONE_TODAY: {
    homeState: "NOT_DONE_TODAY",
    currentStreak: 7,
    bestStreak: 7,
    practiceDates: [
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
    ],
    todayInterviewCount: 0,
    todayPracticeMinutes: 0,
    todayImprovements: [],
    nextActions: ["꼬리 질문엔 근거부터 짧게"],
    nextActionsDate: "2026-10-14",
    recentReviews: [
      { practiceDate: "2026-10-14", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
      { practiceDate: "2026-10-13", companyName: "△△소프트", criterion: "LOGIC", delta: 4 },
    ],
  },
  DONE_TODAY: {
    homeState: "DONE_TODAY",
    currentStreak: 8,
    bestStreak: 8,
    practiceDates: [
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
    ],
    todayInterviewCount: 1,
    todayPracticeMinutes: 18,
    todayImprovements: [
      { criterion: "DELIVERY", delta: 8 },
      { criterion: "LOGIC", delta: 4 },
    ],
    nextActions: ["꼬리 질문엔 근거부터 짧게", "직무 적합성 질문 1개 더 연습하기"],
    nextActionsDate: "2026-10-15",
    recentReviews: [
      { practiceDate: "2026-10-15", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
      { practiceDate: "2026-10-14", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
    ],
  },
  BROKEN: {
    homeState: "BROKEN",
    currentStreak: 0,
    bestStreak: 7,
    practiceDates: ["2026-10-10", "2026-10-11", "2026-10-12"],
    todayInterviewCount: 0,
    todayPracticeMinutes: 0,
    todayImprovements: [],
    nextActions: ["꼬리 질문엔 근거부터 짧게"],
    nextActionsDate: "2026-10-12",
    recentReviews: [
      { practiceDate: "2026-10-12", companyName: "○○전자", criterion: "DELIVERY", delta: 8 },
      { practiceDate: "2026-10-11", companyName: "△△소프트", criterion: "LOGIC", delta: 4 },
    ],
  },
  FIRST_VISIT: {
    homeState: "FIRST_VISIT",
    currentStreak: 0,
    bestStreak: 0,
    practiceDates: [],
    todayInterviewCount: 0,
    todayPracticeMinutes: 0,
    todayImprovements: [],
    nextActions: [],
    nextActionsDate: null,
    recentReviews: [],
  },
} as const;

/** 4.1 지원서 작성 201 · 4.2 조회 · 4.4 수정 200 — Swagger 예시(셋 다 같은 값) */
export const APPLICATION = {
  id: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetter: "1. 지원 동기\n저는…",
  createdAt: "2026-10-15T11:55:00+09:00",
  inUse: false,
} as const satisfies ApplicationResponse;

/** 실패 응답 (RFC 9457 ProblemDetail + code) — Swagger 예시 · mock ErrorCode 문구 */
export const PROBLEM = {
  LOGIN_FAILED: {
    title: "Unauthorized",
    status: 401,
    detail: "이메일 또는 비밀번호를 확인해 주세요.",
    instance: "/api/v1/auth/login",
    code: "LOGIN_FAILED",
  },
  AGREEMENT_REQUIRED: {
    title: "Bad Request",
    status: 400,
    detail: "필수 약관에 모두 동의해 주세요.",
    instance: "/api/v1/auth/signup",
    code: "AGREEMENT_REQUIRED",
  },
  VALIDATION_FAILED: {
    title: "Bad Request",
    status: 400,
    detail: "입력값을 확인해 주세요.",
    instance: "/api/v1/auth/signup",
    code: "VALIDATION_FAILED",
    errors: [{ field: "password", reason: "8~64자, 영문과 숫자를 모두 포함해야 합니다." }],
  },
  // 실제 mock 서버 응답(약관 2개만 보냈을 때). 폼에 없는 칸(agreements)의 오류다.
  VALIDATION_FAILED_AGREEMENTS: {
    title: "Bad Request",
    status: 400,
    detail: "입력값을 확인해 주세요.",
    instance: "/api/v1/auth/signup",
    code: "VALIDATION_FAILED",
    errors: [{ field: "agreements", reason: "약관 3개가 필요합니다." }],
  },
  // 실제 mock 서버 응답(4.1에 회사명 101자 · 자기소개서 3,001자를 보냈을 때). Swagger 4.1에는 400 예시가 없다.
  VALIDATION_FAILED_APPLICATION: {
    title: "Bad Request",
    status: 400,
    detail: "입력값을 확인해 주세요.",
    instance: "/api/v1/applications",
    code: "VALIDATION_FAILED",
    errors: [
      { field: "companyName", reason: "1~100자입니다." },
      { field: "coverLetter", reason: "1~3,000자입니다." },
    ],
  },
  // Swagger 4.2 · 4.4 404 예시
  APPLICATION_NOT_FOUND: {
    title: "Not Found",
    status: 404,
    detail: "지원서를 찾을 수 없어요.",
    instance: "/api/v1/applications/0",
    code: "APPLICATION_NOT_FOUND",
  },
  // Swagger 4.4 409 예시
  APPLICATION_IN_USE: {
    title: "Conflict",
    status: 409,
    detail: "면접에 사용한 지원서는 수정하거나 삭제할 수 없어요.",
    instance: "/api/v1/applications/9",
    code: "APPLICATION_IN_USE",
  },
  EMAIL_DUPLICATED: {
    title: "Conflict",
    status: 409,
    detail: "이미 사용 중인 이메일이에요.",
    instance: "/api/v1/auth/signup",
    code: "EMAIL_DUPLICATED",
  },
  REFRESH_TOKEN_INVALID: {
    title: "Unauthorized",
    status: 401,
    detail: "다시 로그인해 주세요.",
    instance: "/api/v1/auth/token/refresh",
    code: "REFRESH_TOKEN_INVALID",
  },
  // Swagger에 예시가 없어 mock ErrorCode(401 "로그인이 만료됐어요.")와 공통 오류 형식으로 만든다.
  TOKEN_EXPIRED: {
    title: "Unauthorized",
    status: 401,
    detail: "로그인이 만료됐어요.",
    instance: "/api/v1/home",
    code: "TOKEN_EXPIRED",
  },
  UNAUTHORIZED: {
    title: "Unauthorized",
    status: 401,
    detail: "로그인이 필요해요.",
    instance: "/api/v1/users/me",
    code: "UNAUTHORIZED",
  },
  INTERNAL_ERROR: {
    title: "Internal Server Error",
    status: 500,
    detail: "잠시 후 다시 시도해 주세요.",
    instance: "/api/v1/auth/login",
    code: "INTERNAL_ERROR",
  },
} as const satisfies Record<string, ProblemDetail>;
