import type { Persona } from "@/types/api";

// 화면 주소 모음. 화면 번호는 Figma 기준이다.
export const ROUTES = {
  /** S00 랜딩 */
  landing: "/",
  /** S01 로그인 */
  login: "/login",
  /** S01-1 회원가입 */
  signup: "/signup",
  /** 비밀번호 찾기(1.8). S01 로그인 [비밀번호를 잊으셨나요?]로 들어온다 */
  forgotPassword: "/forgot-password",
  /** 비밀번호 재설정(1.9). 재설정 메일의 링크로 들어온다(주소의 token). BE 설정 PASSWORD_RESET_URL과 같아야 한다 */
  passwordReset: "/password-reset",
  /** S02 홈. 오늘 완료(S02-B) · 끊김(S02-C) · 첫 방문(S02-D)도 같은 주소에서 상태로 나눈다. */
  home: "/home",
  /** S03 지원서 선택 — 연습 시작(진행 1단계). 고른 지원서(applicationId)는 주소에 붙일 수 있다. */
  practice: "/practice",
  /** S04 면접관 선택(진행 2단계). 주소에 applicationId(필수) · persona(돌아왔을 때 고른 면접관)를 붙인다. */
  practiceInterviewer: "/practice/interviewer",
  /** S05-1 면접 방식 선택(진행 3단계). 주소에 applicationId · persona를 붙인다. */
  practiceMode: "/practice/mode",
  /** S05 장치 점검(진행 4단계, 화상만). 주소에 sessionId를 붙인다. */
  practiceDevices: "/practice/devices",
  /** 연습 기록(헤더 [연습 기록]). 볼 날짜(date) · 페이지(page)는 주소에 붙인다. */
  records: "/records",
  /** S09 마이페이지. 스트릭 달력에서 볼 달은 주소에 month(YYYY-MM)로 붙인다. */
  mypage: "/mypage",
  /** S09-1 설정 (S09 [설정]으로 들어오고 '‹ 마이페이지'로 돌아간다) */
  settings: "/mypage/settings",
  /** 지원 관리 목록(4.3). S09 '지원 관리' 카드 · 헤더 프로필 메뉴(C01) · 모바일 메뉴 [지원 관리]로 들어온다. 페이지(page, 0부터)는 주소에 붙인다. */
  applications: "/applications",
  /** 지원서 쓰기(4.1). 지원 관리 [+ 지원서 쓰기] · S03 [+ 추가하기]로 들어온다. */
  applicationNew: "/applications/new",
  /** I02 내 문의 목록(회원). 헤더 프로필 메뉴(C01) [문의하기]로 들어온다. 페이지(page, 0부터)는 주소에 붙인다. */
  inquiries: "/inquiries",
  /** I01 문의하기(회원). I02 [+ 문의하기]로 들어온다. */
  inquiryNew: "/inquiries/new",
  /** I04 비회원 문의 확인. 로그인 전 헤더 [문의하기]로 들어온다. 확인하면 같은 화면에서 I03 문의 상세를 보여 준다. */
  guestInquiry: "/inquiries/guest",
  /** I01-B 문의하기(비회원). I04 [+ 문의하기]로 들어온다. */
  guestInquiryNew: "/inquiries/guest/new",
  /** 서비스 이용약관. 랜딩 푸터에서 들어온다(Figma S00 푸터 '이용약관') */
  terms: "/terms",
  /** 개인정보 처리방침. 랜딩 푸터에서 들어온다(Figma S00 푸터 '개인정보처리방침', 「개인정보 보호법」 제30조 공개) */
  privacy: "/privacy",
  /** 카카오 인가 뒤 돌아오는 Route Handler. 로그인(1.6)과 연습 알림 켜기(2.9)가 같은 주소를 쓴다(웹 Swagger 2.9 redirectUri) */
  kakaoCallback: "/oauth/kakao/callback",
  /** 화면을 그리는 도중 액세스 토큰이 만료됐을 때(TOKEN_EXPIRED) 재발급하고 돌아오는 Route Handler */
  tokenRefresh: "/api/auth/refresh",
  /** 화면을 그리는 도중 API가 UNAUTHORIZED를 줬을 때 쿠키를 지우고 로그인 전 상태로 보내는 Route Handler */
  signedOut: "/api/auth/signed-out",
} as const;

/**
 * S04 면접관 선택. S03에서 고른 지원서의 id를 들고 간다. S05-1 [← 면접관 선택]으로 돌아갈 때는 고른 면접관도 넘긴다.
 * 면접 만들기(5.1)는 면접관 · 면접 방식까지 고른 뒤라, 그때까지 고른 값은 주소로 넘긴다.
 */
export function interviewerPath(applicationId: number, persona?: Persona) {
  const personaQuery = persona ? `&persona=${persona}` : "";
  return `${ROUTES.practiceInterviewer}?applicationId=${applicationId}${personaQuery}`;
}

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

/**
 * S07-1 면접 다시보기(6.4). S07 [면접 다시보기]로 들어온다. S07 질문별 피드백의 [자세히 보기]는 그 질문 순서(seq)를 q로 붙여
 * 그 질문을 펼친 채로 연다.
 */
export function replayPath(sessionId: number, seq?: number) {
  const query = seq === undefined ? "" : `?q=${seq}`;
  return `/interview/${sessionId}/replay${query}`;
}

/**
 * S03 지원서 선택을 그 지원서를 골라 둔 채로 연다. S04 [← 지원서 선택] · 지원서 쓰기(S03에서 온 경우) 저장 뒤에 쓴다.
 * added는 지원서 쓰기에서 막 저장하고 돌아온 경우다: 그 줄만 새로 나타나는 연출을 한다(모션 메모 S03 지원서 선택).
 */
export const practiceSelectPath = (applicationId: number, added = false) =>
  `${ROUTES.practice}?applicationId=${applicationId}${added ? "&added=1" : ""}`;

/** 지원 관리 목록을 page(0부터) 페이지로 연다. 첫 페이지는 page를 붙이지 않는다. */
export const applicationsPath = (page = 0) =>
  page > 0 ? `${ROUTES.applications}?page=${page}` : ROUTES.applications;

/**
 * 지원서 상세(4.2). 지원 관리 목록 줄 · 지원서 쓰기 저장 뒤(지원 관리에서 온 경우)로 들어온다.
 * page(0부터)는 면접 기록(4.6)의 쪽이다. 첫 쪽은 page를 붙이지 않는다.
 */
export function applicationPath(applicationId: number, page = 0) {
  const query = page > 0 ? `?page=${page}` : "";
  return `${ROUTES.applications}/${applicationId}${query}`;
}

/** 지원서 쓰기를 어디서 열었는지. 저장 뒤 · [← 뒤로]가 이곳으로 돌아간다(사용자 결정 2026-10-29) */
export type ApplicationWriteFrom = "applications" | "practice";

/** 지원서 쓰기. S03 [+ 추가하기]로 열 때는 from=practice를 붙인다. */
export const applicationNewPath = (from: ApplicationWriteFrom = "applications") =>
  from === "practice" ? `${ROUTES.applicationNew}?from=practice` : ROUTES.applicationNew;

/** S09 마이페이지의 스트릭 달력을 month(YYYY-MM) 달로 연다. */
export const mypagePath = (month: string) => `${ROUTES.mypage}?month=${month}`;

/**
 * 연습 기록을 date(YYYY-MM-DD, 면접 시작일) 날짜 · page(0부터) 페이지로 연다. 첫 페이지는 page를 붙이지 않는다.
 * S09 스트릭 달력 날짜도 여기로 온다.
 */
export function recordsPath(date: string, page = 0) {
  const pageQuery = page > 0 ? `&page=${page}` : "";
  return `${ROUTES.records}?date=${date}${pageQuery}`;
}

/** S09 프로필 사진 ✎ → S09-1 설정의 프로필 사진 줄(모션 메모 S09) */
export const PROFILE_IMAGE_ANCHOR = "profile-image";

/** S08 날짜별 성장 리뷰(S08-B 설문 · S08-C 첫 면접 포함). practiceDate는 YYYY-MM-DD */
export const growthReviewPath = (practiceDate: string) => `/reviews/${practiceDate}`;

/** S07 [오늘의 성장 리뷰 보기]: 면접을 막 마치고 들어오는 오늘 성장 리뷰. 그날 첫 면접이면 'N일째 달성!'을 먼저 띄운다 */
export const finishedReviewPath = (practiceDate: string) =>
  `${growthReviewPath(practiceDate)}?from=result`;

/** I03 문의 상세(회원, 9.3). I02 줄 · I01 [문의 보내기]로 들어온다. 비회원 문의 상세는 I04 화면 안에서 보여 준다. */
export const inquiryPath = (inquiryId: number) => `${ROUTES.inquiries}/${inquiryId}`;

/** I02 내 문의 목록을 page(0부터) 페이지로 연다. 첫 페이지는 page를 붙이지 않는다. */
export const inquiriesPath = (page = 0) =>
  page > 0 ? `${ROUTES.inquiries}?page=${page}` : ROUTES.inquiries;

/** 로그인하지 않아도 볼 수 있는 화면 */
export const PUBLIC_PATHS: readonly string[] = [
  ROUTES.landing,
  ROUTES.login,
  ROUTES.signup,
  ROUTES.forgotPassword,
  ROUTES.passwordReset,
  ROUTES.guestInquiry,
  ROUTES.guestInquiryNew,
  ROUTES.terms,
  ROUTES.privacy,
  ROUTES.kakaoCallback,
];

/**
 * 로그인한 사람은 들어오지 않는 화면(로그인하면 홈으로 보낸다). 비회원 문의 화면은 로그인하면 토큰이 붙어 회원 문의가 되므로
 * 로그인 전에만 연다(회원은 프로필 메뉴의 문의하기로 간다).
 */
export const GUEST_ONLY_PATHS: readonly string[] = [
  ROUTES.login,
  ROUTES.signup,
  ROUTES.forgotPassword,
  ROUTES.guestInquiry,
  ROUTES.guestInquiryNew,
];
