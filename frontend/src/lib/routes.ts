import type { Persona } from "@/types/api";

// 화면 주소 모음. 화면 번호는 Figma·API 명세 기준이다.
export const ROUTES = {
  /** S00 랜딩 */
  landing: "/",
  /** S01 로그인 */
  login: "/login",
  /** S01-1 회원가입 */
  signup: "/signup",
  /** S02 홈. 오늘 완료(S02-B) · 끊김(S02-C) · 첫 방문(S02-D)도 같은 주소에서 상태로 나눈다. */
  home: "/home",
  /** S03 지원서 입력 — 연습 시작(진행 1단계) */
  practice: "/practice",
  /** S04 면접관 선택(진행 2단계). 주소에 applicationId(필수) · persona(돌아왔을 때 고른 면접관)를 붙인다. */
  practiceInterviewer: "/practice/interviewer",
  /** S05-1 면접 방식 선택(진행 3단계). 주소에 applicationId · persona를 붙인다. */
  practiceMode: "/practice/mode",
  /** S05 장치 점검(진행 4단계, 화상만). 주소에 sessionId를 붙인다. */
  practiceDevices: "/practice/devices",
  /** 헤더 [연습 기록] (화면 미정) */
  records: "/records",
  /** S09 마이페이지. 스트릭 달력에서 볼 달은 주소에 month(YYYY-MM)로 붙인다. */
  mypage: "/mypage",
  /** S09-1 설정 (S09 [설정]으로 들어오고 '‹ 마이페이지'로 돌아간다) */
  settings: "/mypage/settings",
  /** 화면을 그리는 도중 액세스 토큰이 만료됐을 때(TOKEN_EXPIRED) 재발급하고 돌아오는 Route Handler */
  tokenRefresh: "/api/auth/refresh",
  /** 화면을 그리는 도중 API가 UNAUTHORIZED를 줬을 때 쿠키를 지우고 로그인 전 상태로 보내는 Route Handler */
  signedOut: "/api/auth/signed-out",
} as const;

/**
 * S04 면접관 선택. S03에서 만든 지원서(4.1)의 id를 들고 간다. S05-1 [← 면접관 선택]으로 돌아갈 때는 고른 면접관도 넘긴다.
 * 면접 만들기(5.1)는 면접관 · 면접 방식까지 고른 뒤라, 그때까지 고른 값은 주소로 넘긴다.
 */
export const interviewerPath = (applicationId: number, persona?: Persona) =>
  `${ROUTES.practiceInterviewer}?applicationId=${applicationId}${persona ? `&persona=${persona}` : ""}`;

/** S05-1 면접 방식 선택. S05 [← 면접 방식]으로 돌아갈 때 그 면접의 지원서 · 면접관을 넘긴다. */
export const modePath = (applicationId: number, persona: Persona) =>
  `${ROUTES.practiceMode}?applicationId=${applicationId}&persona=${persona}`;

/** S05 장치 점검(화상). S05-1에서 만든 면접(5.1)의 id를 들고 간다. */
export const devicesPath = (sessionId: number) =>
  `${ROUTES.practiceDevices}?sessionId=${sessionId}`;

/** S06 면접(화상) · S06-B 면접(채팅) · S06-E 종료 확인 · S06-1 결과 분석 중. 채팅은 S05-1에서 장치 점검 없이 바로 온다. */
export const interviewPath = (sessionId: number) => `/interview/${sessionId}`;

/** S07 피드백 결과(6.3). 결과가 나오면(COMPLETED) S06-1에서 넘어온다. */
export const resultPath = (sessionId: number) => `/interview/${sessionId}/result`;

/** S07-1 면접 다시보기(6.4). S07 [면접 다시보기]로 들어온다. */
export const replayPath = (sessionId: number) => `/interview/${sessionId}/replay`;

/** S03 지원서 입력을 S04 [← 지원서 수정]에서 다시 열 때. 그 지원서(4.2)로 칸을 채우고 4.4로 고친다. */
export const applicationEditPath = (applicationId: number) =>
  `${ROUTES.practice}?applicationId=${applicationId}`;

/** S09 마이페이지의 스트릭 달력을 month(YYYY-MM) 달로 연다. */
export const mypagePath = (month: string) => `${ROUTES.mypage}?month=${month}`;

/** S09 프로필 사진 ✎ → S09-1 설정의 프로필 사진 줄(모션 메모 S09) */
export const PROFILE_IMAGE_ANCHOR = "profile-image";

/** S08 날짜별 성장 리뷰(S08-B 설문 · S08-C 첫 면접 포함). practiceDate는 YYYY-MM-DD */
export const growthReviewPath = (practiceDate: string) => `/reviews/${practiceDate}`;

/** S07 [오늘의 성장 리뷰 보기]: 면접을 막 마치고 들어오는 오늘 성장 리뷰. 그날 첫 면접이면 'N일째 달성!'을 먼저 띄운다 */
export const finishedReviewPath = (practiceDate: string) =>
  `${growthReviewPath(practiceDate)}?from=result`;

/** 로그인하지 않아도 볼 수 있는 화면 */
export const PUBLIC_PATHS: readonly string[] = [ROUTES.landing, ROUTES.login, ROUTES.signup];

/** 로그인한 사람은 들어오지 않는 화면(로그인하면 홈으로 보낸다) */
export const GUEST_ONLY_PATHS: readonly string[] = [ROUTES.login, ROUTES.signup];
