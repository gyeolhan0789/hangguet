// 웹 mock 서버 Swagger(https://hangguet.yobistory.com/mock/be/v3/api-docs)의 응답 예시를 그대로 옮긴 값.
// E2E는 이 값을 MSW 핸들러 응답으로 돌려준다. Swagger 예시가 바뀌면 같이 바꾼다.
// 단, 액세스 토큰 예시 "eyJ…"는 생략 표기(…)라 HTTP 헤더에 넣을 수 없어서, 같은 모양의 ASCII 값으로 바꿨다.
import type {
  AnswerResponse,
  ApplicationListResponse,
  ApplicationResponse,
  ApplicationSessionListResponse,
  CompanyListResponse,
  PendingResponse,
  QuestionResponse,
  MeResponse,
  MyStreakFreezesResponse,
  NicknameChangeResponse,
  NoticesResponse,
  StreakFreezeUseResponse,
  PracticeAlarmResponse,
  PracticeLogsResponse,
  ProblemDetail,
  SessionResponse,
  SocialLoginResponse,
  StatsResponse,
  UploadUrlResponse,
} from "../../src/types/api";

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
  socialProvider: null,
  linkedProvider: null,
  profileImageUrl: "https://…",
  createdAt: "2026-09-01T10:00:00+09:00",
  currentStreak: 7,
} satisfies MeResponse;

/** 2.1 내 정보 200 — 카카오로 가입한 회원(소셜 회원은 비밀번호가 없다) */
export const KAKAO_ME = {
  ...ME,
  email: "a@kakao.com",
  socialProvider: "KAKAO",
} satisfies MeResponse;

/** 2.8 연습 알림 설정 200 — 이메일 회원(카카오로 가입하지 않아 켤 수 없다) */
export const PRACTICE_ALARM_UNAVAILABLE = {
  available: false,
  enabled: false,
  time: "21:00",
} satisfies PracticeAlarmResponse;

/** 2.8 연습 알림 설정 200 — 카카오 회원, 꺼짐 */
export const PRACTICE_ALARM_OFF = {
  available: true,
  enabled: false,
  time: "21:00",
} satisfies PracticeAlarmResponse;

/** 1.6 소셜 로그인 200 — 웹 Swagger 예시 '처음 온 사람' */
export const SOCIAL_SIGNUP_REQUIRED = {
  signupRequired: true,
  token: null,
  signup: { signupToken: "Zm9v", email: "a@kakao.com", nickname: "면접왕", expiresIn: 600 },
} satisfies SocialLoginResponse;

/** 2.2 닉네임 변경 200 — 웹 Swagger 예시(내 정보 + 토큰의 nickname이 바뀐 새 액세스 토큰) */
export const NICKNAME_CHANGED = {
  ...ME,
  accessToken: "eyJhbGciOiJIUzI1NiJ9.e2e-nickname",
  expiresIn: 3600,
} satisfies NicknameChangeResponse;

/** 3.2 통계 200 — Swagger 예시 */
export const STATS = {
  currentStreak: 7,
  bestStreak: 12,
  totalInterviewCount: 23,
  totalPracticeMinutes: 400,
  latestJobTitle: "백엔드 개발자",
} satisfies StatsResponse;

/** 3.3 연습 달력 200 — 웹 Swagger 예시 '한국 시간 시작일 기준'(2026-10-20 · 21) */
export const PRACTICE_LOGS = {
  content: [
    { practiceDate: "2026-10-20", createdAt: "2026-10-20T20:10:00+09:00" },
    { practiceDate: "2026-10-21", createdAt: "2026-10-21T19:42:00+09:00" },
  ],
} satisfies PracticeLogsResponse;

/**
 * 3.3 연습 달력 — Figma S09 스트릭 달력(18:2930)과 같은 10월(1~3 · 6~12일 연습, 오늘 13일).
 * 웹 Swagger 예시는 두 날뿐이라, 띠가 주를 넘어가는 모양을 보려고 Figma 그림의 날짜로 만든다(createdAt은 테스트 값).
 */
export const PRACTICE_LOGS_FIGMA = {
  content: ["01", "02", "03", "06", "07", "08", "09", "10", "11", "12"].map((day) => ({
    practiceDate: `2026-10-${day}`,
    createdAt: `2026-10-${day}T21:12:00+09:00`,
  })),
} satisfies PracticeLogsResponse;

/**
 * 2.4 프로필 사진 업로드 주소 200 — Swagger 예시.
 * 예시의 uploadUrl("https://…s3…?X-Amz-Signature=…")은 생략 표기라 브라우저가 PUT할 수 없어서, 같은 모양의 주소로 바꿨다.
 */
export const UPLOAD_URL = {
  uploadUrl: "https://s3.e2e.test/profile/1/7f3c.png?X-Amz-Signature=e2e",
  objectKey: "profile/1/7f3c….png",
  expiresAt: "2026-10-15T12:10:00+09:00",
} satisfies UploadUrlResponse;

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

/**
 * 4.1 지원서 작성 201 · 4.2 조회 200 — Swagger 예시(지원서 12의 문항 2개). 다른 E2E가 applicationId=10을 주소에 쓰므로 id만 10이다.
 */
export const APPLICATION = {
  id: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  coverLetterItems: [
    {
      itemOrder: 1,
      question: "지원 동기",
      answer:
        "저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어 ○○전자 백엔드 직무에 지원했습니다.",
    },
    {
      itemOrder: 2,
      question: "협업 경험",
      answer: "4명이 함께한 프로젝트에서 API 설계를 맡아 조회 응답 시간을 40% 줄였습니다.",
    },
  ],
  createdAt: "2026-10-15T11:55:00+09:00",
} as const satisfies ApplicationResponse;

/** 4.3 지원서 목록 200 — Swagger 예시(웹 목 실제 응답과 같음, 최근 작성순) */
export const APPLICATION_LIST = {
  content: [
    {
      id: 12,
      companyName: "○○전자",
      jobTitle: "백엔드 개발자",
      createdAt: "2026-10-15T11:55:00+09:00",
    },
    {
      id: 9,
      companyName: "△△소프트",
      jobTitle: "서버 개발자",
      createdAt: "2026-10-11T20:10:00+09:00",
    },
  ],
  page: { size: 10, number: 0, totalElements: 2, totalPages: 1 },
} satisfies ApplicationListResponse;

/**
 * 4.6 지원서의 연습 면접 목록 200 — Swagger 예시가 아니라, 로컬 mock이 지원서 12에 실제로 돌려주는 응답이다
 * (면접 55 · 52, 시작 시각 내림차순. mock/src/main/java/com/ssafy/a301/interview/SessionExamples.java).
 */
export const APPLICATION_SESSIONS = {
  content: [
    {
      id: 55,
      companyName: "○○전자",
      jobTitle: "백엔드 개발자",
      persona: "DEVIL",
      mode: "VIDEO",
      status: "COMPLETED",
      startedAt: "2026-10-21T23:50:00+09:00",
      endedAt: "2026-10-22T00:10:00+09:00",
      answeredCount: 5,
      summary: "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
      criterionGrades: [
        { criterion: "JOB_FIT", grade: "GOOD" },
        { criterion: "COVER_LETTER", grade: "WEAK" },
        { criterion: "LOGIC", grade: "GOOD" },
        { criterion: "DELIVERY", grade: "NORMAL" },
      ],
    },
    {
      id: 52,
      companyName: "○○전자",
      jobTitle: "백엔드 개발자",
      persona: "DEVIL",
      mode: "CHAT",
      status: "COMPLETED",
      startedAt: "2026-10-20T20:00:00+09:00",
      endedAt: "2026-10-20T20:10:00+09:00",
      answeredCount: 2,
      summary: null,
      criterionGrades: [
        { criterion: "JOB_FIT", grade: "NORMAL" },
        { criterion: "COVER_LETTER", grade: "NORMAL" },
        { criterion: "LOGIC", grade: "GOOD" },
        { criterion: "DELIVERY", grade: "NORMAL" },
      ],
    },
  ],
  page: { size: 10, number: 0, totalElements: 2, totalPages: 1 },
} satisfies ApplicationSessionListResponse;

/** 4.6 지원서의 연습 면접 목록 200 — Swagger 예시(면접이 없는 지원서) */
export const APPLICATION_NO_SESSIONS = {
  content: [],
  page: { size: 10, number: 0, totalElements: 0, totalPages: 0 },
} satisfies ApplicationSessionListResponse;

/** 4.7 회사 목록 200 — Swagger 예시(영문 다음 한글 가나다순) */
export const COMPANIES = {
  content: [
    { id: 2, name: "NAVER", aliases: ["naver", "네이버"] },
    { id: 7, name: "NC", aliases: ["nc", "ncsoft", "엔씨소프트"] },
    { id: 3, name: "SK하이닉스", aliases: ["sk하이닉스", "skhynix"] },
    { id: 1, name: "삼성전자", aliases: ["삼성전자", "samsungelectronics"] },
    { id: 5, name: "카카오", aliases: ["카카오", "kakao"] },
    { id: 4, name: "현대자동차", aliases: ["현대자동차", "hyundaimotorcompany"] },
  ],
} satisfies CompanyListResponse;

/** 5.1 면접 만들기 201 — Swagger 예시 */
export const SESSION = {
  id: 55,
  applicationId: 10,
  companyName: "○○전자",
  jobTitle: "백엔드 개발자",
  persona: "DEVIL",
  mode: "VIDEO",
  status: "READY",
  planStatus: "GENERATING",
  planProgress: 0,
  analysisStep: null,
  currentQuestion: null,
  answeredCount: 0,
  elapsedSeconds: 0,
  startedAt: null,
  endedAt: null,
  createdAt: "2026-10-15T11:58:30+09:00",
  leveledUp: null,
  room: null,
} as const satisfies SessionResponse;

/** 5.2 면접 조회 200 — Swagger 예시 'S05·S05-E 질문 준비 78%' · 'S05 플랜 생성 실패'. 준비 완료는 예시가 없어 5.4 시작 전 상태로 만든다. */
export const SESSION_PLAN = {
  GENERATING: { ...SESSION, planStatus: "GENERATING", planProgress: 78 },
  READY: { ...SESSION, planStatus: "READY", planProgress: null },
  FAILED: { ...SESSION, planStatus: "FAILED", planProgress: null },
} as const satisfies Record<string, SessionResponse>;

/** 5.4 면접 시작 200 — Swagger 예시 */
export const SESSION_STARTED = {
  ...SESSION,
  status: "IN_PROGRESS",
  planStatus: "READY",
  planProgress: null,
  currentQuestion: { id: 301, seq: 1, content: "1분 동안 자기소개 부탁드려요." },
  startedAt: "2026-10-15T12:00:00+09:00",
  room: {
    url: "wss://rtc.hangguet.co.kr",
    token: "eyJhbGciOiJIUzI1NiJ9…",
    expiresAt: "2026-10-15T12:10:00+09:00",
  },
} as const satisfies SessionResponse;

/** 5.2 면접 조회 200 — Swagger 예시 'S06·S06-B 면접 중' · 'S06 다음 질문 생성 중' · 'S06-1 결과 분석 중' */
export const SESSION_INTERVIEW = {
  IN_PROGRESS: {
    ...SESSION,
    status: "IN_PROGRESS",
    planStatus: "READY",
    planProgress: null,
    currentQuestion: { id: 303, seq: 3, content: "가장 큰 기술적 문제는 무엇이었나요?" },
    answeredCount: 2,
    elapsedSeconds: 522,
    startedAt: "2026-10-15T12:00:00+09:00",
  },
  NEXT_QUESTION_GENERATING: {
    ...SESSION,
    status: "IN_PROGRESS",
    planStatus: "READY",
    planProgress: null,
    currentQuestion: null,
    answeredCount: 3,
    elapsedSeconds: 640,
    startedAt: "2026-10-15T12:00:00+09:00",
  },
  ANALYZING: {
    ...SESSION,
    status: "ANALYZING",
    planStatus: "READY",
    planProgress: null,
    analysisStep: "SCORING",
    answeredCount: 5,
    elapsedSeconds: 1080,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: "2026-10-15T12:18:00+09:00",
  },
} as const satisfies Record<string, SessionResponse>;

/** 5.8 면접 끝내기 — Swagger 예시 202 'S06-E 답변한 2개까지 → S06-1' · 200 '답변 0개 → 홈' */
export const SESSION_ENDED = {
  ANALYZING: {
    ...SESSION,
    status: "ANALYZING",
    planStatus: "READY",
    planProgress: null,
    analysisStep: "ORGANIZING_ANSWERS",
    answeredCount: 2,
    elapsedSeconds: 522,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: "2026-10-15T12:08:42+09:00",
    leveledUp: true,
    room: null,
  },
  ABORTED: {
    ...SESSION,
    status: "ABORTED",
    planStatus: "READY",
    planProgress: null,
    answeredCount: 0,
    elapsedSeconds: 95,
    startedAt: "2026-10-15T12:00:00+09:00",
    endedAt: "2026-10-15T12:01:35+09:00",
    leveledUp: false,
    room: null,
  },
} as const satisfies Record<string, SessionResponse>;

/** 5.5 지금 질문 — Swagger 예시 200(질문 303) · 202(다음 질문 생성 중) */
export const QUESTION_CURRENT = {
  id: 303,
  seq: 3,
  content: "흐음~ ○○ 프로젝트라. 거기서 '직접' 한 부분만 쏙 골라서 말해볼래요?",
  createdAt: "2026-10-15T12:06:12+09:00",
} as const satisfies QuestionResponse;
export const QUESTION_GENERATING = {
  code: "QUESTION_GENERATING",
} as const satisfies PendingResponse;

/** 5.7 답변 제출 202 — Swagger 예시(id 903 · 질문 303)를 채팅(TEXT)으로 바꾼 것 */
export const ANSWER = {
  id: 903,
  questionId: 303,
  inputType: "TEXT",
  createdAt: "2026-10-15T12:08:40+09:00",
  isLastQuestion: false,
} as const satisfies AnswerResponse;

/** 6.3 면접 결과 · 6.4 다시보기 200 — Swagger 예시. 단위 테스트와 같은 값을 쓴다. */
export { REPLAY, RESULT } from "../../src/test/result-examples";

/** 7.1 날짜별 성장 리뷰 200 — Swagger 예시. 단위 테스트와 같은 값을 쓴다. */
export { GROWTH_REVIEW } from "../../src/test/growth-review-examples";

/** 5.13 연습 면접 목록 · 5.15 월별 연습 면접 횟수 200 — 웹 Swagger 예시 · 웹 목 서버 실제 응답. 단위 테스트와 같은 값을 쓴다. */
export { SESSION_CALENDAR, SESSION_LIST } from "../../src/test/session-list-examples";

/** 실패 응답 (RFC 9457 ProblemDetail + code) — 웹 Swagger 예시 */
export const PROBLEM = {
  LOGIN_FAILED: {
    title: "Unauthorized",
    status: 401,
    detail: "이메일 또는 비밀번호를 확인해 주세요.",
    instance: "/api/v1/auth/login",
    code: "LOGIN_FAILED",
  },
  // 웹 Swagger 1.3 429 예시
  LOGIN_LOCKED: {
    title: "Too Many Requests",
    status: 429,
    detail: "로그인에 여러 번 실패했어요. 잠시 후 다시 시도해 주세요.",
    instance: "/api/v1/auth/login",
    code: "LOGIN_LOCKED",
    retryAfterSeconds: 900,
  },
  // 웹 Swagger 1.9 400 예시
  PASSWORD_RESET_TOKEN_INVALID: {
    title: "Bad Request",
    status: 400,
    detail: "비밀번호 재설정 링크가 만료됐어요. 다시 요청해 주세요.",
    instance: "/api/v1/auth/password-reset/confirm",
    code: "PASSWORD_RESET_TOKEN_INVALID",
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
  // Swagger 4.1 400 예시(질문을 만들기 어려운 자기소개서)
  COVER_LETTER_UNUSABLE: {
    title: "Bad Request",
    status: 400,
    detail: "입력값을 확인해 주세요.",
    instance: "/api/v1/applications",
    code: "VALIDATION_FAILED",
    errors: [
      {
        field: "coverLetterItems",
        reason:
          "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요.",
      },
    ],
  },
  // 실제 mock 서버 응답(5.1에 Idempotency-Key 헤더 없이 보냈을 때). Swagger 5.1에는 400 예시가 없다.
  VALIDATION_FAILED_IDEMPOTENCY_KEY: {
    title: "Bad Request",
    status: 400,
    detail: "입력값을 확인해 주세요.",
    instance: "/api/v1/interview-sessions",
    code: "VALIDATION_FAILED",
    errors: [{ field: "Idempotency-Key", reason: "필수 헤더입니다." }],
  },
  // Swagger 4.2 · 4.5 · 4.6 404 예시
  APPLICATION_NOT_FOUND: {
    title: "Not Found",
    status: 404,
    detail: "지원서를 찾을 수 없어요.",
    instance: "/api/v1/applications/0",
    code: "APPLICATION_NOT_FOUND",
  },
  // Swagger 5.2 · 5.3 · 5.4 404 예시
  SESSION_NOT_FOUND: {
    title: "Not Found",
    status: 404,
    detail: "면접을 찾을 수 없어요.",
    instance: "/api/v1/interview-sessions/0",
    code: "SESSION_NOT_FOUND",
  },
  // Swagger 7.1 404 예시
  GROWTH_REVIEW_NOT_FOUND: {
    title: "Not Found",
    status: 404,
    detail: "그날의 성장 리뷰가 없어요.",
    instance: "/api/v1/growth-reviews/2026-10-01",
    code: "GROWTH_REVIEW_NOT_FOUND",
  },
  // Swagger 6.3 409 예시
  RESULT_NOT_READY: {
    title: "Conflict",
    status: 409,
    detail: "결과를 만들고 있어요.",
    instance: "/api/v1/interview-sessions/55/result",
    code: "RESULT_NOT_READY",
  },
  // Swagger 6.3 409 예시
  NO_RESULT: {
    title: "Conflict",
    status: 409,
    detail: "답변 없이 끝난 면접은 결과가 없어요.",
    instance: "/api/v1/interview-sessions/55/result",
    code: "NO_RESULT",
  },
  // Swagger 5.4 409 예시
  PLAN_NOT_READY: {
    title: "Conflict",
    status: 409,
    detail: "면접관이 질문을 준비하고 있어요.",
    instance: "/api/v1/interview-sessions/55/start",
    code: "PLAN_NOT_READY",
  },
  // Swagger 2.3 · 2.7 400 예시(2.7 예시의 instance도 /password로 같다)
  PASSWORD_MISMATCH: {
    title: "Bad Request",
    status: 400,
    detail: "비밀번호가 맞지 않아요.",
    instance: "/api/v1/users/me/password",
    code: "PASSWORD_MISMATCH",
  },
  // Swagger 2.5 404 예시
  FILE_NOT_FOUND: {
    title: "Not Found",
    status: 404,
    detail: "업로드한 파일을 찾을 수 없어요.",
    instance: "/api/v1/users/me/profile-image",
    code: "FILE_NOT_FOUND",
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
  // 웹 Swagger에 예시가 없어 공통 오류(401 TOKEN_EXPIRED)를 ProblemDetail 형식으로 만든다(detail은 테스트 값).
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

/** 8.8 공지 목록 200 — Swagger 예시 '확인 안 함 1개 · 확인함 1개'(최신순) */
export const NOTICES = {
  content: [
    {
      id: 3,
      title: "10월 점검 안내",
      content: "10월 30일 02:00~04:00 서비스 점검이 있어요.",
      startsAt: "2026-10-23T09:00:00+09:00",
      read: false,
    },
    {
      id: 2,
      title: "채팅 면접이 열렸어요",
      content: "이제 글로도 면접을 볼 수 있어요.",
      startsAt: "2026-10-20T09:00:00+09:00",
      read: true,
    },
  ],
} satisfies NoticesResponse;

/** 8.8 공지 목록 200 — Swagger 예시 '공지 없음'. 기본값으로 쓴다 */
export const NOTICES_EMPTY = { content: [] } satisfies NoticesResponse;

/** 8.13 내 스트릭 유지권 200 — Swagger 예시 '2개 있음'. 고른 유지권을 구분하도록 둘째는 다른 날짜(테스트 값)로 바꿨다 */
export const STREAK_FREEZES = {
  availableCount: 2,
  freezes: [
    {
      id: 31,
      fillableDate: "2026-10-19",
      grantedAt: "2026-10-20T00:00:00+09:00",
      expiresAt: "2026-11-03T00:00:00+09:00",
    },
    {
      id: 32,
      fillableDate: "2026-10-22",
      grantedAt: "2026-10-23T00:00:00+09:00",
      expiresAt: "2026-11-06T00:00:00+09:00",
    },
  ],
} satisfies MyStreakFreezesResponse;

/** 8.14 유지권 사용 200 — Swagger 예시 */
export const STREAK_FREEZE_USED = {
  practiceDate: "2026-10-19",
  freezeId: 31,
  availableCount: 1,
  currentStreak: 9,
} satisfies StreakFreezeUseResponse;
